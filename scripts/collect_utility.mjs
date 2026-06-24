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
async function fetchHeco(c) {
  const key = process.env[c.requiresSecret || "HECO_ACCESS_KEY"];
  if (!key) throw new Error(`heco: ${c.requiresSecret || "HECO_ACCESS_KEY"} not set`);
  if (c.proxyUrl) return jget(c.proxyUrl, { Authorization: `Bearer ${key}` });
  const { fetchHecoRaw } = await import("../workers/heco-proxy.mjs");
  return fetchHecoRaw(key, c.company || "HECO");
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
  const H = { Referer: c.referer || new URL(base).origin };
  const all = [];
  const pageSize = c.pageSize || 2000;
  // advance by the actual returned count (servers cap below pageSize, e.g. Entergy's 1000) and stop only
  // when the server says there's no more (exceededTransferLimit false) or a page is empty.
  for (let i = 0, offset = 0; i < 100; i++) {
    const url = `${base}/${layer}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&f=json&resultOffset=${offset}&resultRecordCount=${pageSize}`;
    const r = await jget(url, H);
    const fs = r.features || [];
    all.push(...fs);
    offset += fs.length;
    if (!r.exceededTransferLimit || fs.length === 0) break;
  }
  return { features: all };
}

const FETCH = { kubra: fetchKubra, duke: fetchDuke, pge: fetchPge, fpl: fetchFpl, gvea: fetchGvea, chugach: fetchChugach, kiuc: fetchKiuc, heco: fetchHeco, arcgis: fetchArcgis };

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
