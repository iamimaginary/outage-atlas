// NorthWestern Energy (MT/SD/NE). ASP.NET ScriptService { "d": "<json-string>" } — the d string is a
// JSON-encoded array of point-level outage events that must be parsed a second time (done in fetchNwe).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };
export function parseNwe(raw, opts = {}) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.events) ? raw.events : null);
  if (!arr) throw new Error("nwe: not an events array (expected double-parsed .d)");
  const areas = arr.map((e, i) => {
    const out = Math.max(0, num(first(e.NUM_CUST, e.numCust, e.CustomersAffected)));
    const lat = num(first(e.LATITUDE, e.lat, e.Y)), lon = num(first(e.LONGITUDE, e.lng, e.lon, e.X));
    return { name: String(first(e.AREA, e.CITY, e.LOCATION, e.NAME) || `outage #${i}`), out, served: out, etr: typeof first(e.ETR, e.EstimatedRestoration) === "string" ? first(e.ETR, e.EstimatedRestoration) : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("nwe: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
