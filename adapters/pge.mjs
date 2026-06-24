// PG&E adapter. PG&E's outage map is backed by an OPEN Esri ArcGIS MapServer (no auth, no key). The
// live data layer (4 "Outage Locations") is a FLAT list of per-incident outage POINTS with no city /
// county attribute and no customers-served count — just EST_CUSTOMERS (out), an ETR, a cause, and a
// point geometry. So each incident becomes one canonical `area` (located by lat/lon, with its own ETR);
// there is no geographic rollup to group by. THIS module is the pure part: raw ArcGIS query response ->
// canonical.
//
// served gap: the feed omits served everywhere. We floor each area `served` to its `out` (so the
// schema's out<=served holds and the headline `out` stays exact) and the collector injects the SYSTEM
// served total (official.served) from config.servedTotal — a static EIA figure (~5.5M). The large
// per-feature `blueSkyNotificationSubscription` blob is irrelevant and is excluded by the fetch field list.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// EPSG:3857 (Web Mercator) -> [lat,lon] — fallback when geometry isn't already returned in WGS84.
function webMercToLatLon(x, y) {
  if (!isFinite(x) || !isFinite(y)) return null;
  const R = 20037508.342789244;
  const lon = (x / R) * 180;
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(((y / R) * 180) * Math.PI / 180)) - Math.PI / 2);
  return [r5(lat), r5(lon)];
}
function pointLoc(a, g) {
  if (a.OUTAGE_LATITUDE != null && a.OUTAGE_LONGITUDE != null) return [num(a.OUTAGE_LATITUDE), num(a.OUTAGE_LONGITUDE)];
  if (g && g.x != null && g.y != null) {
    return (Math.abs(g.x) <= 180 && Math.abs(g.y) <= 90) ? [r5(num(g.y)), r5(num(g.x))] : webMercToLatLon(num(g.x), num(g.y));
  }
  return null;
}

// raw  = ArcGIS layer query response: { features: [ { attributes:{...}, geometry:{x,y} }, ... ] }
// opts = the utility config (collector passes cfg.config); opts.servedTotal sets official.served.
export function parsePge(raw, opts = {}) {
  const feats = raw && Array.isArray(raw.features) ? raw.features : null;
  if (!feats) throw new Error("pge: missing features[]");
  let totOut = 0;
  const areas = feats.map((f, i) => {
    const a = f.attributes || {};
    const out = Math.max(0, num(a.EST_CUSTOMERS));
    totOut += out;
    const id = String(a.OUTAGE_ID || a.F_OUTAGE_ID || a.OBJECTID || i);
    const city = a.CITY && String(a.CITY).trim();
    return {
      name: city || `PG&E outage #${id}`,
      out,
      served: out, // served unavailable in the feed -> floor to out
      etr: typeof a.CURRENT_ETOR_TEXT === "string" ? a.CURRENT_ETOR_TEXT : null,
      loc: pointLoc(a, f.geometry),
      subs: [],
    };
  });
  const official = { out: totOut, served: num(opts.servedTotal) || totOut, nOut: feats.length };
  return { official, areas };
}
