// National baseline collector. Fetches ODIN (county-level outages) + NWS (active weather alerts),
// aggregates via adapters/odin.mjs, and writes the small sharded baseline to data/national/.
// Runs server-side (GitHub Actions) every ~15 min; the page reads the published snapshot from the
// tracker-data branch (and can fall back to fetching ODIN directly — it's CORS-open).
//
//   node scripts/collect_baseline.mjs            # writes data/national/{baseline,index}.json
//
// Best-effort weather: if NWS fails, the baseline still publishes (alerts just absent).
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { parseOdinRecords } from "../adapters/odin.mjs";
import { countyEta } from "./lib/eta.mjs";

const ODIN_BASE = "https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county";
const ODIN_FIELDS = "communitydescriptor,county,state,utility_id,name,metersaffected,estimatedrestorationtime,geo_point_2d";
const NWS_ALERTS = "https://api.weather.gov/alerts/active";
const UA = "outage-atlas/0.1 (+https://github.com/iamimaginary/outage-atlas)";
const OUT_DIR = "data/national";

// fetch JSON with a few retries + a hard timeout (a stalled fetch must never hang the pipeline)
async function jget(url, headers = {}, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
    }
  }
  throw new Error(`GET ${url} failed: ${lastErr && lastErr.message}`);
}

// Pull ALL ODIN records: prefer the export endpoint (no pagination cap); fall back to paginated records.
async function fetchOdin() {
  try {
    const arr = await jget(`${ODIN_BASE}/exports/json?select=${ODIN_FIELDS}`, { Accept: "application/json" });
    if (Array.isArray(arr)) return arr;
  } catch (e) {
    console.error("odin export failed, falling back to paginated records:", e.message);
  }
  const all = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = await jget(`${ODIN_BASE}/records?select=${ODIN_FIELDS}&limit=100&offset=${offset}`, { Accept: "application/json" });
    const res = (page && page.results) || [];
    all.push(...res);
    if (res.length < 100) break;
  }
  return all;
}

// NWS active alerts -> [{id,event,severity,onset,ends,areaDesc,fips:[...]}]; SAME geocode = "0"+FIPS.
async function fetchAlerts() {
  const data = await jget(NWS_ALERTS, { "User-Agent": UA, Accept: "application/geo+json" });
  const feats = (data && data.features) || [];
  return feats.map((f) => {
    const p = f.properties || {};
    const same = (p.geocode && p.geocode.SAME) || [];
    const fips = same.map((s) => String(s).replace(/^0/, "")).filter((s) => /^\d{5}$/.test(s));
    return { id: p.id, event: p.event, severity: p.severity, onset: p.onset || null, ends: p.ends || p.expires || null, areaDesc: p.areaDesc || "", fips };
  });
}

(async () => {
  const collectedAt = Date.now();
  const records = await fetchOdin();
  const { national, counties } = parseOdinRecords(records);
  if (!national.counties) throw new Error("ODIN returned no usable counties — refusing to publish a blank baseline");

  // --- per-county history -> algorithmic recovery ETA (the universal "every ZIP gets a recovery time") ---
  // Accumulate a bounded out-over-time series per FIPS across runs, track a running peak, and derive an
  // ETA for each active county. A county no longer reporting an outage has recovered, so it drops from
  // history (keeps history.json ~= currently-active counties). ETA quality improves as runs accumulate.
  const HIST_PATH = `${OUT_DIR}/history.json`;
  const SERIES_CAP = 48; // ~12h at the 15-min cadence
  let prevHist = {};
  if (existsSync(HIST_PATH)) { try { prevHist = JSON.parse(readFileSync(HIST_PATH, "utf8")); } catch {} }
  const history = {};
  for (const fips of Object.keys(counties)) {
    const out = counties[fips].out;
    const prev = prevHist[fips] || { peak: 0, series: [] };
    const series = (prev.series || []).concat([{ t: collectedAt, out }]);
    while (series.length > SERIES_CAP) series.shift();
    const peak = Math.max(prev.peak || 0, out);
    history[fips] = { peak, series };
    counties[fips].eta = countyEta(series, out, peak);
  }

  let alerts = [];
  try { alerts = await fetchAlerts(); }
  catch (e) { console.error("NWS alerts unavailable (non-fatal):", e.message); }

  // index of FIPS -> active weather alert events, so the page can flag "weather context" per county
  const alertsByFips = {};
  for (const a of alerts) for (const fips of a.fips) (alertsByFips[fips] = alertsByFips[fips] || []).push(a.event);

  const baseline = { schema: 1, collectedAt, source: "odin", national, counties, alerts, alertsByFips };

  // read-modify-write index.json so we preserve the `deep` manifest that collect_utility maintains
  mkdirSync(OUT_DIR, { recursive: true });
  let index = { schema: 1, deep: {} };
  if (existsSync(`${OUT_DIR}/index.json`)) { try { index = JSON.parse(readFileSync(`${OUT_DIR}/index.json`, "utf8")); } catch {} }
  index.schema = 1;
  index.generatedAt = collectedAt;
  index.baseline = { source: "odin", collectedAt, counties: national.counties, out: national.out, states: national.states, utilities: national.utilities };
  index.deep = index.deep || {};

  writeFileSync(`${OUT_DIR}/baseline.json`, JSON.stringify(baseline));
  writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify(index, null, 2));
  writeFileSync(HIST_PATH, JSON.stringify(history));

  const trend = { improving: 0, holding: 0, rising: 0, collecting: 0 };
  for (const fips of Object.keys(counties)) trend[counties[fips].eta.kind] = (trend[counties[fips].eta.kind] || 0) + 1;
  console.log(`baseline written: ${national.out} out across ${national.counties} counties / ${national.states} states / ${national.utilities} utilities; ${alerts.length} active NWS alerts (${Object.keys(alertsByFips).length} counties under an alert)`);
  console.log(`recovery ETA: ${trend.improving} improving, ${trend.holding} holding, ${trend.rising} rising, ${trend.collecting} collecting`);
})().catch((e) => { console.error("collect_baseline FAILED:", e.message); process.exit(1); });
