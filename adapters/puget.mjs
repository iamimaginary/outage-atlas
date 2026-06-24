// Puget Sound Energy adapter. In-house Sitecore JSON feed (GET .../OutageMap/AnonymoussMapListView —
// the double-s typo is required). UnplannedOutageSummary headline + PseMap[] incidents (point grain,
// no served denominator -> system served from config.servedTotal). Attributes are RefName/Value pairs.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const attr = (da, name) => { const a = da && Array.isArray(da.Attributes) ? da.Attributes.find((x) => x.RefName === name) : null; return a ? a.Value : null; };
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

export function parsePuget(raw, opts = {}) {
  const sum = raw && raw.UnplannedOutageSummary;
  const map = raw && Array.isArray(raw.PseMap) ? raw.PseMap : null;
  if (!sum || !map) throw new Error("puget: missing UnplannedOutageSummary/PseMap");
  // Emit every active incident on the map (PlannedOutage isn't reliably flagged per-incident and the
  // summary's unplanned-only headline doesn't match the map's incident sum). Derive official from the
  // areas so the snapshot is self-consistent (= total customers out across all listed incidents).
  const areas = map.map((p, i) => {
    const da = p.DataProvider || {}, poi = da.PointOfInterest || {};
    const out = Math.max(0, toInt(attr(da, "Customers impacted")));
    const lat = num(Number(poi.Latitude)), lon = num(Number(poi.Longitude));
    const etr = attr(da, "Est. Restoration time");
    return { name: String(poi.Title || `outage #${i}`), out, served: out, etr: typeof etr === "string" ? etr : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("puget: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
