// CLECO Power (LA). Azure APIM JSON: { data:[ {affectedCount, location, latitude, longitude, restorationTime} ] }.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };
export function parseCleco(raw, opts = {}) {
  const data = raw && Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : null);
  if (!data) throw new Error("cleco: missing data[]");
  const areas = data.map((o, i) => {
    const out = Math.max(0, num(first(o.affectedCount, o.customersAffected, o.affected, o.numberAffected)));
    const lat = num(first(o.latitude, o.lat)), lon = num(first(o.longitude, o.lng, o.lon));
    const etr = first(o.restorationTime, o.estimatedRestoration, o.etr, o.estimatedRestorationTime);
    return { name: String(first(o.location, o.area, o.city, o.name) || `outage #${i}`), out, served: out, etr: typeof etr === "string" ? etr : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("cleco: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
