// ODIN (Outage Data Initiative Nationwide, DOE/ORNL) adapter — the national baseline source.
// Pure parser: raw ODIN records -> a FIPS-keyed county aggregate. ODIN is the free, no-key,
// CORS-open national feed (https://ornl.opendatasoft.com/.../odin-real-time-outages-county).
//
// IMPORTANT: ODIN reports customers/meters OUT only — there is NO "customers served" denominator in
// the feed. So the national baseline is an OUT-COUNT product (FIPS -> customers out), validated by its
// own check_baseline.mjs, NOT by the per-utility canonical schema (which requires `served`). The
// canonical {official, areas[subs]} contract is reserved for DEEP per-utility feeds (Kübra et al.).
//
// Each ODIN record is one incident: communitydescriptor (5-digit county FIPS), metersaffected (out),
// utility_id/name, county/state, estimatedrestorationtime ('{"ert": "..."}' or null). We roll incidents
// up to counties (and a national total), keeping a per-utility breakdown per county for "max detail".
//
// Fix loop for an agent: a drift/parse break auto-captures the raw payload to adapters/fixtures/odin/.
// Reproduce with `node scripts/test_adapters.mjs`, edit this parser until the fixture passes.

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const cleanName = (s) => String(s || "").replace(/,\s*\d+\s*$/, "").trim(); // drop trailing ",<id>"
// ODIN geo_point_2d / centroid is {lon,lat} -> canonical [lat,lon] (for the map); null if absent
const locOf = (r) => { const g = (r && (r.geo_point_2d || r.centroid)) || null; return g && typeof g.lat === "number" && typeof g.lon === "number" ? [g.lat, g.lon] : null; };

// earliest ERT among incident records ('{"ert":"ISO"}' or null) -> ISO string | null
function earliestEtr(records) {
  let best = null;
  for (const r of records) {
    const raw = r.estimatedrestorationtime;
    if (!raw) continue;
    let ert = null;
    try { ert = typeof raw === "string" ? (JSON.parse(raw).ert || null) : (raw.ert || null); } catch { ert = null; }
    if (ert && (!best || ert < best)) best = ert;
  }
  return best;
}

// raw = the ODIN API response (either a bare array of records, or {results:[...]}). Returns the
// baseline aggregate. Throws only on a structurally unusable payload (so a blank/garbage feed can't
// silently publish an empty baseline).
export function parseOdinRecords(raw) {
  const recs = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.results) ? raw.results : null);
  if (!recs) throw new Error("odin: expected an array of records or {results:[...]}");

  const counties = {};
  const utilSeen = new Set();
  const stateSeen = new Set();
  let nationalOut = 0;

  // group incidents by FIPS
  const byFips = {};
  for (const r of recs) {
    const fips = String(r.communitydescriptor || "").trim();
    if (!/^\d{5}$/.test(fips)) continue; // skip records without a clean county FIPS
    (byFips[fips] = byFips[fips] || []).push(r);
  }

  for (const fips of Object.keys(byFips).sort()) {
    const group = byFips[fips];
    const utilMap = {}; // utility_id -> {id, name, out, incidents}
    let cOut = 0;
    for (const r of group) {
      const out = num(r.metersaffected);
      cOut += out;
      const id = String(r.utility_id ?? "");
      const u = (utilMap[id] = utilMap[id] || { id, name: cleanName(r.name), out: 0, incidents: 0 });
      u.out += out;
      u.incidents += 1;
      utilSeen.add(id);
    }
    const st = group[0].state || "";
    if (st) stateSeen.add(st);
    nationalOut += cOut;
    counties[fips] = {
      fips,
      county: group[0].county || "",
      state: st,
      out: cOut,
      incidents: group.length,
      etr: earliestEtr(group),
      loc: locOf(group[0]),
      utilities: Object.values(utilMap).sort((a, b) => b.out - a.out)
    };
  }

  const aggregated = Object.values(counties).reduce((a, c) => a + c.incidents, 0);
  const national = {
    out: nationalOut,
    incidents: aggregated,           // records rolled into a county (valid FIPS)
    skipped: recs.length - aggregated, // records with no usable county FIPS (a drift signal if large)
    counties: Object.keys(counties).length,
    utilities: utilSeen.size,
    states: stateSeen.size
  };
  return { national, counties };
}
