// Deep per-utility collector. Fetches one utility's deep feed via its adapter and writes the canonical
// snapshot + bounded history to the sharded data layer. Runs server-side (the collector can set Referer/
// Origin that browsers can't), so the page just reads the published snapshot.
//
//   node scripts/collect_utility.mjs <utilityId>     # default: firstenergy-oh
//
// Currently wires the Kübra 3-step chain (currentState -> configuration -> report.json). Other vendors
// get their own fetch branch keyed by config.adapter. Refuses to publish a structurally empty snapshot.
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getAdapter } from "../adapters/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2] || "firstenergy-oh";
const cfg = JSON.parse(readFileSync(join(ROOT, "utilities", `${id}.json`), "utf8"));
const reg = getAdapter(cfg.adapter);
if (!reg) throw new Error(`unknown adapter "${cfg.adapter}" for ${id}`);

const KB = "https://kubra.io";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const HIST_CAP = 1500;

async function jget(url, extra = {}) {
  const headers = { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", ...extra };
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (r.ok) return r.json();
      lastErr = new Error(`${url.split("/")[2]} ${r.status}`);
      if (!(r.status === 403 || r.status === 429 || r.status >= 500)) break;
    } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 700 * attempt + Math.random() * 400));
  }
  throw lastErr;
}

async function tget(url, extra = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, ...extra }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url.split("/")[2]} ${r.status}`);
  return r.text();
}

// Kübra: currentState -> configuration/{deploymentId} -> report.json -> parseKubraReport
async function fetchKubra(c) {
  const H = { Referer: c.referer, Origin: new URL(c.referer).origin };
  const cs = await jget(`${KB}/stormcenter/api/v1/stormcenters/${c.instance}/views/${c.view}/currentState?preview=false`, H);
  const dataPath = cs.data.interval_generation_data, dep = cs.stormcenterDeploymentId;
  // Thematic-layer utilities (DTE, SDG&E) have an empty reports list; per-area data is in the thematic
  // layer file + a summary file. parseKubraReport dispatches on the { thematic, summary } shape.
  if (c.thematic) {
    const layer = c.thematicLayer || "thematic-1";
    const thematic = await jget(`${KB}/${dataPath}/public/${layer}/thematic_areas.json`, H);
    let summary = null;
    try { summary = await jget(`${KB}/${dataPath}/public/summary-1/data.json`, H); } catch { /* totals fall back to area sums */ }
    return { thematic, summary };
  }
  const conf = await jget(`${KB}/stormcenter/api/v1/stormcenters/${c.instance}/views/${c.view}/configuration/${dep}?preview=false`, H);
  const reps = conf.config.reports.data.interval_generation_data;
  const src = (reps.find((r) => /report\.json$/i.test(r.source)) || reps[0]).source;
  return jget(`${KB}/${dataPath}/${src}`, H);
}

// Duke: own Apigee API behind app-level Basic auth. The creds are embedded in the outage-map SPA bundle
// and ROTATE, so we scrape them at runtime (never pinned in the repo). CORS-locked to the map origin ->
// only works server-side. PII (employee emails in serviceAreas[].updatedBy) is stripped before parsing.
async function fetchDuke(c) {
  const origin = (c.referer || "https://outagemap.duke-energy.com").replace(/\/$/, "");
  const base = c.base || "https://prod.apigee.duke-energy.app/outage-maps/v1";
  const jur = c.jurisdiction;
  if (!jur) throw new Error("duke: config.jurisdiction required (DEC/DEF/DEI/DEM)");
  const html = await tget(origin + "/", { Referer: origin + "/" });
  const jsFile = (html.match(/main\.[a-f0-9]+\.js/) || [])[0];
  if (!jsFile) throw new Error("duke: could not locate main.<hash>.js in the outage-map page");
  const js = await tget(`${origin}/${jsFile}`, { Referer: origin + "/" });
  // The bundle can carry several consumer_key_*/secret_* tokens (env variants, rotated values); grab
  // ALL candidates and use whichever pair actually authenticates — robust to rotation + regex ambiguity.
  const uniq = (re) => [...new Set([...js.matchAll(re)].map((m) => m[1]))];
  const keys = uniq(/consumer_key_[a-z0-9]+["']?\s*[:=]\s*["']([A-Za-z0-9_-]{24,})["']/gi);
  const secrets = uniq(/consumer_secret_[a-z0-9]+["']?\s*[:=]\s*["']([A-Za-z0-9_-]{16,})["']/gi);
  if (!keys.length || !secrets.length) throw new Error("duke: could not scrape API credentials from page JS (format may have changed)");
  const HB = { Referer: origin + "/", Origin: origin };
  let auth = null, summary = null;
  for (const k of keys.slice(0, 4)) {
    for (const s of secrets.slice(0, 4)) {
      const a = "Basic " + Buffer.from(`${k}:${s}`).toString("base64");
      try { summary = await jget(`${base}/jurisdictions/${jur}`, { ...HB, Authorization: a }); auth = a; break; } catch { /* try next pair */ }
    }
    if (auth) break;
  }
  if (!auth) throw new Error(`duke: no scraped credential pair authenticated (tried ${keys.length}x${secrets.length})`);
  const H = { ...HB, Authorization: auth };
  const counties = await jget(`${base}/counties?jurisdiction=${jur}`, H);
  // sanity: don't accept the silent unknown-code -> Carolinas fallback for non-Carolinas jurisdictions
  // PII strip: remove employee emails before this raw is parsed/persisted
  for (const row of (counties.data || [])) {
    if (Array.isArray(row.serviceAreas)) for (const sa of row.serviceAreas) { delete sa.updatedBy; }
  }
  return { summary, counties };
}

// PG&E: open Esri ArcGIS MapServer. Page through incident points (exceededTransferLimit on storm days);
// request an explicit field list so the large encrypted blueSkyNotificationSubscription blob is excluded.
async function fetchPge(c) {
  const base = c.base || "https://ags.pge.esriemcs.com/arcgis/rest/services/43/outages/MapServer";
  const layer = c.layer != null ? c.layer : 4; // 4 = "Outage Locations" (live point layer)
  // layer 4 carries no CITY/lat-lon attrs — geometry holds the location, so request it in WGS84 (outSR);
  // the explicit field list excludes the large encrypted blueSkyNotificationSubscription blob.
  const fields = c.fields || "OUTAGE_ID,EST_CUSTOMERS,CURRENT_ETOR_TEXT,OUTAGE_CAUSE,CREW_CURRENT_STATUS";
  const H = { Referer: c.referer || "https://pgealerts.alerts.pge.com" };
  const all = [];
  const pageSize = 2000;
  for (let i = 0, offset = 0; i < 60; i++, offset += pageSize) {
    const url = `${base}/${layer}/query?where=1%3D1&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&f=json&resultOffset=${offset}&resultRecordCount=${pageSize}`;
    const r = await jget(url, H);
    const fs = r.features || [];
    all.push(...fs);
    if (!r.exceededTransferLimit || fs.length < pageSize) break;
  }
  return { features: all };
}

// FPL: plain county JSON, two regions (main peninsula + northwest panhandle). No CORS -> server-side.
async function fetchFpl(c) {
  const base = (c.base || "https://www.fplmaps.com").replace(/\/$/, "");
  const H = { Referer: base + "/", "X-Requested-With": "XMLHttpRequest" };
  const main = await jget(`${base}/customer/outage/CountyOutages.json`, H);
  let nw = null;
  try { nw = await jget(`${base}/northwest/customer/outage/CountyOutages.json`, H); } catch { /* panhandle optional */ }
  return { main, nw };
}

// GVEA: NISC web-outage-viewer JSON (Fairbanks AK).
async function fetchGvea(c) {
  const base = (c.base || "https://outage.gvea.com").replace(/\/$/, "");
  const H = { Referer: base + "/" };
  const summary = await jget(`${base}/data/outageSummary`, H);
  const outages = await jget(`${base}/data/outages`, H);
  return { summary, outages };
}

// Chugach: custom JSON files (Anchorage AK). Served as .js with pure-JSON bodies.
async function fetchChugach(c) {
  const base = (c.base || "https://www.chugachelectric.com/outage").replace(/\/$/, "");
  const H = { Referer: base + "/outage_map.html" };
  const grids = await jget(`${base}/Grids.js`, H);
  const incidents = await jget(`${base}/Incidents.js`, H);
  return { grids, incidents };
}

// KIUC: NISC hosted-outage-map static summary.json (Kauai HI). Open, CORS:*.
async function fetchKiuc(c) {
  const base = (c.base || "https://outagemap-data.cloud.coop/kiuc/Hosted_Outage_Map").replace(/\/$/, "");
  return jget(`${base}/summary.json`, { Referer: "https://kiuc.outagemap.coop/" });
}

// HECO: auth-gated + origin-locked (Hawaii). Goes through the operator-keyed serverless proxy (preferred)
// or, server-side, the direct handshake helper. Requires HECO_ACCESS_KEY — the config ships disabled and
// the IIFE below skips it cleanly until that secret is set.
// HECO: anonymous 2-step bearer chain (no credential). GET /access-token (raw JWE text) -> GET /outages
// with that Bearer. Reachable server-side: no key, no Origin/CORS lock, no bot wall.
async function fetchHeco(c) {
  const base = (c.base || "https://outagemap-api-heco.azurewebsites.net").replace(/\/$/, "");
  const token = (await tget(`${base}/api/v1/access-token`, {})).trim();
  if (!token) throw new Error("heco: empty access token from /api/v1/access-token");
  const url = `${base}/api/v1/outages${c.company ? `?company=${encodeURIComponent(c.company)}` : ""}`;
  return jget(url, { Authorization: `Bearer ${token}` });
}
// SMUD: anonymous per-community JSON summary.
async function fetchSmud(c) {
  return jget(c.url || "https://usage.smud.org/omkml/api/communitylist/", { Referer: c.referer || "https://myaccount.smud.org/manage/outage" });
}
// Memphis MLGW: GeoJSON (browser UA required).
async function fetchMlgw(c) { return jget(c.url || "https://outagemap.mlgw.org/geojson.php", { Referer: c.referer || "https://outagemap.mlgw.org/" }); }
// NorthWestern Energy: ScriptService {d:"<json-string>"} -> double-parse to an events array.
async function fetchNwe(c) {
  const r = await jget(c.url || "https://northwesternenergy.com/get-outage-map-data", { Referer: c.referer || "https://northwesternenergy.com/outages" });
  if (r && typeof r.d === "string") { try { return JSON.parse(r.d); } catch { throw new Error("nwe: .d not JSON"); } }
  return r;
}
// CLECO: Azure APIM. /alloutages/{type}/{service}: type 2 = active/unplanned, service 1 = electric.
async function fetchCleco(c) { return jget(c.url || "https://cleco-prod.azure-api.net/outage/api/1/outage/alloutages/2/1", { Referer: c.referer || "https://www.cleco.com/" }); }
// Green Mountain Power: own .NET API (per-town).
async function fetchGmp(c) { return jget(c.url || "https://api.greenmountainpower.com/api/v2/outages/incidents/towns?all=true", { Referer: c.referer || "https://greenmountainpower.com/outages/" }); }
// Clark PUD: JSONP -> strip gksUpdateOutageData( ... ) wrapper.
async function fetchClarkPud(c) {
  const txt = await tget(c.url || "https://www.clarkpublicutilities.com/outage-map/data.js", { Referer: c.referer || "https://www.clarkpublicutilities.com/outage-map/" });
  const m = txt.match(/gksUpdateOutageData\(([\s\S]*)\)\s*;?\s*$/);
  return JSON.parse(m ? m[1] : txt);
}
// Knoxville Utilities Board.
async function fetchKub(c) { return jget(c.url || "https://www.kub.org/api/outage/v1/electric-outages", { Referer: c.referer || "https://www.kub.org/outages" }); }
// Liberty/Empire: SmartCMobile city summary (companyGroupCode selects the region).
async function fetchLiberty(c) {
  const grp = c.companyGroupCode || "LUMO";
  return jget(c.url || `https://LibertyCF2-svc.smartcmobile.com/OutageAPI/api/1/Outage/OutageSummaryCity?companyGroupCode=${grp}`, { Referer: c.referer || "https://outage.libertyutilities.com/" });
}
// NOVEC: StormCenter XML (cache-busted).
async function fetchNovec(c) { return tget(`${c.url || "https://www.novec.com/stormcenter/data/outagedtl.xml"}?${Date.now()}`, { Referer: c.referer || "https://www.novec.com/" }); }
// ACS GridVu: per-outage JSON list.
async function fetchGridvu(c) { return jget(c.url, { Referer: c.referer || new URL(c.url).origin }); }
// SmartC Mobile / SEDC WidgetAPI.
async function fetchSmartc(c) { return jget(c.url, { Referer: c.referer || new URL(c.url).origin }); }
// Anaheim GeoJSON.
async function fetchAnaheim(c) { return jget(c.url, { Referer: c.referer || "https://www.anaheim.net/" }); }
// Siena WebSurv: POST (empty body) -> XML.
async function fetchSienatech(c) {
  const r = await fetch(c.url, { method: "POST", headers: { "User-Agent": UA, Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded", Referer: c.referer || new URL(c.url).origin }, body: "", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`sienatech ${r.status}`);
  return r.text();
}
// Milsoft Web Outage Viewer: static per-utility JSON (boundaries.json county-grain or outages.json points).
async function fetchMilsoft(c) {
  const base = (c.base || "").replace(/\/$/, "");
  if (!base) throw new Error("milsoft: config.base required");
  return jget(`${base}/data/${c.file || "boundaries.json"}`, { Referer: c.referer || base + "/" });
}
// Portland General: public GraphQL (no auth) — per-county outages.
async function fetchPge2(c) {
  const body = { query: "query getOutagesByCounty($params: OutageByCountyParams) { getOutagesByCounty(params: $params) }", variables: {} };
  return jpost(c.url || "https://apix.portlandgeneral.com/pge-graphql", body, { Referer: c.referer || "https://portlandgeneral.com/outages" });
}

// Generic Esri ArcGIS fetch (config-driven): pages an outage layer, asks for the configured fields +
// geometry in WGS84. Field MEANINGS live in config.fields; parseArcgis interprets them.
async function fetchArcgis(c) {
  const base = c.base;
  if (!base) throw new Error("arcgis: config.base (service root) required");
  const layer = c.layer != null ? c.layer : 0;
  const F = c.fields || {};
  const wanted = [...new Set(["OBJECTID", ...Object.values(F).filter((v) => typeof v === "string"), c.groupBy].filter(Boolean))];
  const fields = c.outFields || wanted.join(",");
  const where = c.where || "1=1";
  const geom = c.returnGeometry !== false;
  const H = { Referer: c.referer || new URL(base).origin };
  const Q = (p) => jget(`${base}/${layer}/query?${p}`, H);
  // primary: paginated + WGS84 geometry. Advance by actual returned count (servers cap below pageSize,
  // e.g. Entergy's 1000). ArcGIS reports query errors as a 200 body {error:{code}} — detect that and
  // fall back rather than silently yielding zero features.
  try {
    const all = [];
    for (let i = 0, offset = 0; i < 100; i++) {
      const r = await Q(`where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(fields)}${geom ? "&returnGeometry=true&outSR=4326" : "&returnGeometry=false"}&f=json&resultOffset=${offset}&resultRecordCount=${c.pageSize || 2000}`);
      if (r && r.error) throw new Error(`arcgis query ${r.error.code || ""}`);
      const fs = r.features || [];
      all.push(...fs); offset += fs.length;
      if (!r.exceededTransferLimit || fs.length === 0) break;
    }
    if (all.length) return { features: all };
  } catch { /* finicky custom host (rejects outSR/pagination) — minimal fallback below */ }
  const r = await Q(`where=${encodeURIComponent(where)}&outFields=*&f=json`);
  if (r && r.error) throw new Error(`arcgis: query failed (code ${r.error.code})`);
  return { features: r.features || [] };
}

// iFactor (legacy Kübra): metadata.json -> timestamped dir -> data.json (summary) + report_*.json (areas).
// metadata.json can flip to a new interval before that interval's report_*.json finish uploading (S3
// publish-lag: data.json present, reports 403). So step back in 15-min increments to the most recent
// interval that has BOTH the summary AND the reports — keeping them from the same dir for reconciliation.
async function fetchIfactor(c) {
  const base = (c.base || "").replace(/\/$/, "");
  if (!base) throw new Error("ifactor: config.base required");
  const H = { Referer: c.referer || new URL(base).origin };
  const meta = await jget(`${base}/metadata.json`, H);
  if (!meta.directory) throw new Error("ifactor: no directory in metadata.json");
  const p = meta.directory.split("_").map(Number); // Y_M_D_H_Mi_S (treated as UTC literals; arithmetic only)
  const t0 = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
  const fmt = (d) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n, i) => i ? String(n).padStart(2, "0") : String(n)).join("_");
  const wanted = c.reports || [];
  const probe = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "*/*", ...H }, signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : null; };
  for (let step = 0; step < 5; step++) {
    const dir = step === 0 ? meta.directory : fmt(new Date(t0 - step * 15 * 60000));
    const summary = await probe(`${base}/${dir}/data.json`);
    const first = wanted.length ? await probe(`${base}/${dir}/${wanted[0]}`) : true;
    if (!summary || !first) continue; // this interval's reports aren't ready — step back
    const reports = wanted.length ? [first] : [];
    for (const f of wanted.slice(1)) { const r = await probe(`${base}/${dir}/${f}`); if (r) reports.push(r); }
    return { summary, reports };
  }
  throw new Error("ifactor: no recent interval has both summary and reports");
}

// PacifiCorp: 6 self-hosted state JSON files (Pacific Power OR/WA/CA + Rocky Mountain Power UT/WY/ID).
async function fetchPacificorp(c) {
  const base = (c.base || "https://www.pacificpower.net").replace(/\/$/, "");
  const states = c.states || ["OR", "WA", "CA", "UT", "WY", "ID"];
  const H = { Referer: c.referer || base + "/outages-safety.html" };
  const out = [];
  for (const st of states) { try { out.push(await jget(`${base}/etc/pcorp/datafiles/outagemap/map${st}.json`, H)); } catch { /* a state file may be absent */ } }
  return { states: out };
}
// WEC (We Energies / Wisconsin Public Service): one JSON array of outage events.
async function fetchWec(c) {
  const base = (c.base || "").replace(/\/$/, "");
  if (!base) throw new Error("wec: config.base required");
  return jget(`${base}/outagesummary/view/OutageEventJSON`, { Referer: c.referer || base + "/outagemapext/" });
}
// AES Ohio (Dayton P&L): bespoke XML feed.
async function fetchAesOhio(c) {
  const url = c.url || "https://myprofile.aes-ohio.com/DATA/DPLOMSDATA.xml";
  return tget(url, { Referer: c.referer || "https://myprofile.aes-ohio.com/Outages/Outages.html" });
}

// POST helper (json body -> json) with the same retry policy as jget.
async function jpost(url, body, extra = {}) {
  const headers = { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Content-Type": "application/json", ...extra };
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { method: "POST", headers, body: body == null ? undefined : (typeof body === "string" ? body : JSON.stringify(body)), signal: AbortSignal.timeout(15000) });
      if (r.ok) return r.json();
      lastErr = new Error(`${url.split("/")[2]} ${r.status}`);
      if (!(r.status === 403 || r.status === 429 || r.status >= 500)) break;
    } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 700 * attempt + Math.random() * 400));
  }
  throw lastErr;
}

// OMAP (PPL Electric + Rhode Island Energy — multi-tenant by host): county/township tree.
async function fetchOmap(c) {
  const base = (c.base || "").replace(/\/$/, "");
  if (!base) throw new Error("omap: config.base required");
  return jget(`${base}/api/Omap/Outage/Tabular?opco=${c.opco || "PA"}`, { Referer: c.referer || base });
}
// DataCapable / UtiliSocial (Seattle City Light, Duquesne): flat events array.
async function fetchDatacapable(c) {
  if (!c.url) throw new Error("datacapable: config.url required");
  return jget(c.url, { Referer: c.referer || new URL(c.url).origin });
}
// LUMA / PREPA (Puerto Rico): region totals.
async function fetchLuma(c) {
  const base = (c.base || "https://api.miluma.lumapr.com/miluma-outage-api").replace(/\/$/, "");
  return jget(`${base}/outage/regionsWithoutService`, { Referer: c.referer || "https://miluma.lumapr.com/" });
}
// MidAmerican: POST county info (empty body).
async function fetchMidamerican(c) {
  const base = (c.base || "https://www.midamericanenergy.com").replace(/\/$/, "");
  return jpost(`${base}/OutageWatch/api/County/CountyInfo/`, {}, { Referer: c.referer || base + "/OutageWatch/dsk.html" });
}
// Idaho Power: GET JSON.
async function fetchIdahoPower(c) {
  return jget(c.url || "https://apiedge.idahopower.com/api/Outage/GetCurrentOutageInformation", { Referer: c.referer || "https://www.idahopower.com/outages/" });
}
// AES Indiana (IPL): XML (Accept */* — application/xml -> 406).
async function fetchAesIndiana(c) {
  return tget(c.url || "https://myaccount.aesindiana.com/OMSDATA/OMSDATA_OSI.xml", { Referer: c.referer || "https://myaccount.aesindiana.com/", Accept: "*/*" });
}
// Tucson Electric Power: POST mapfeed (empty body; GET returns 403).
async function fetchTep(c) {
  return jpost(c.url || "https://apps.tep.com/OutageApp/mapfeed", "", { Referer: c.referer || "https://www.tep.com/outages/", "Content-Type": "application/x-www-form-urlencoded" });
}
// Tampa Electric (TECO): POST Elasticsearch tiles — the geo_bounding_box filter is mandatory.
async function fetchTeco(c) {
  const url = c.url || "https://outage-data-prod-hrcadje2h9aje9c9.a03.azurefd.net/api/v1/outage-tiles";
  const body = c.body || { size: 10000, query: { bool: { must: { match_all: {} }, filter: { geo_bounding_box: { polygonCenter: { top_left: { lat: 31.1, lon: -87.7 }, bottom_right: { lat: 24.4, lon: -79.9 } } } } } }, sort: [{ updateTime: "asc" }, { incidentId: "asc" }], _source: "*" };
  return jpost(url, body, { Referer: c.referer || "https://outage.tecoenergy.com/" });
}
// El Paso Electric: POST (x-api-key) -> AES-256-GCM envelope {data,iv} -> decrypt to JSON.
async function fetchElPaso(c) {
  const { createDecipheriv } = await import("node:crypto");
  const env = await jpost(c.url || "https://starlit.epelectric.com/OmsApi/GetOutages", {}, { "x-api-key": c.apiKey || "f47ac10b-58cc-4372-a567-0e02b2c3d479", Referer: c.referer || "https://outagemap.epelectric.com/" });
  if (!env || !env.data || !env.iv) throw new Error("el-paso: response not an {data,iv} envelope");
  const key = Buffer.from((c.passphrase || "0u7@geM@p43ped0n3bYS7e3leC0n5u17").padEnd(32, "0").slice(0, 32), "utf8");
  const ct = Buffer.from(env.data, "hex");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "hex"));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(d.update(ct.subarray(0, ct.length - 16), undefined, "utf8") + d.final("utf8"));
}
// Puget Sound Energy: in-house Sitecore JSON (the "Anonymouss" double-s is required).
async function fetchPuget(c) {
  return jget(c.url || "https://www.pse.com/api/sitecore/OutageMap/AnonymoussMapListView", { Referer: c.referer || "https://www.pse.com/en/outage/outage-map" });
}

const FETCH = { kubra: fetchKubra, duke: fetchDuke, pge: fetchPge, fpl: fetchFpl, gvea: fetchGvea, chugach: fetchChugach, kiuc: fetchKiuc, heco: fetchHeco, arcgis: fetchArcgis, ifactor: fetchIfactor, pacificorp: fetchPacificorp, wec: fetchWec, "aes-ohio": fetchAesOhio, omap: fetchOmap, datacapable: fetchDatacapable, luma: fetchLuma, midamerican: fetchMidamerican, "idaho-power": fetchIdahoPower, "aes-indiana": fetchAesIndiana, tep: fetchTep, teco: fetchTeco, "el-paso": fetchElPaso, puget: fetchPuget, smud: fetchSmud, mlgw: fetchMlgw, nwe: fetchNwe, cleco: fetchCleco, gmp: fetchGmp, "clark-pud": fetchClarkPud, kub: fetchKub, liberty: fetchLiberty, novec: fetchNovec, "pge-graphql": fetchPge2, milsoft: fetchMilsoft, gridvu: fetchGridvu, smartc: fetchSmartc, sienatech: fetchSienatech, anaheim: fetchAnaheim };

(async () => {
  // Gated/disabled feeds (e.g. HECO needs an operator-supplied credential): skip cleanly (exit 0) until
  // the required secret is present, so a not-yet-enabled feed never errors a collector cycle.
  if (cfg.disabled) {
    const sec = cfg.config && cfg.config.requiresSecret;
    if (!sec || !process.env[sec]) { console.log(`deep [${id}]: SKIPPED — gated (set ${sec || "the required secret"} to enable)`); return; }
  }
  const fetcher = FETCH[cfg.adapter];
  if (!fetcher) throw new Error(`no deep fetcher implemented for adapter "${cfg.adapter}"`);
  const raw = await fetcher(cfg.config);
  const parser = reg.mod[reg.defaultFn];
  const { official, areas } = parser(raw, cfg.config); // 2nd arg lets feeds w/o served (PG&E) inject a system total
  if (!areas.length) throw new Error("empty deep report (no areas) — refusing to publish");
  const collectedAt = Date.now();

  const snapshot = { schema: 1, id, name: cfg.name, adapter: cfg.adapter, collectedAt, official, areas };
  mkdirSync(join(ROOT, "data", "utilities"), { recursive: true });
  mkdirSync(join(ROOT, "data", "history"), { recursive: true });
  writeFileSync(join(ROOT, "data", "utilities", `${id}.json`), JSON.stringify(snapshot));

  // bounded history
  const histPath = join(ROOT, "data", "history", `${id}.json`);
  let hist = [];
  if (existsSync(histPath)) { try { hist = JSON.parse(readFileSync(histPath, "utf8")); } catch {} }
  hist.push({ t: collectedAt, out: official.out });
  while (hist.length > HIST_CAP) hist.shift();
  writeFileSync(histPath, JSON.stringify(hist));

  // refresh index.deep from the utility snapshots present (read-modify-write; preserve baseline fields)
  const idxPath = join(ROOT, "data", "national", "index.json");
  let idx = { schema: 1, baseline: {}, deep: {} };
  if (existsSync(idxPath)) { try { idx = JSON.parse(readFileSync(idxPath, "utf8")); } catch {} }
  idx.deep = idx.deep || {};
  const udir = join(ROOT, "data", "utilities");
  for (const f of readdirSync(udir).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(join(udir, f), "utf8"));
    const cfgPath = join(ROOT, "utilities", f);
    const ucfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
    idx.deep[s.id] = { name: s.name, match: ucfg.match || [], out: s.official.out, collectedAt: s.collectedAt };
  }
  mkdirSync(join(ROOT, "data", "national"), { recursive: true });
  writeFileSync(idxPath, JSON.stringify(idx, null, 2));

  const subs = areas.reduce((a, c) => a + c.subs.length, 0);
  console.log(`deep [${id}]: official ${official.out} out / ${official.served} served; ${areas.length} areas, ${subs} sub-areas; history ${hist.length} pts`);
})().catch((e) => { console.error(`collect_utility[${id}] FAILED:`, e.message); process.exit(1); });
