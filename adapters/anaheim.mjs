// Anaheim Public Utilities adapter. GeoJSON FeatureCollection of per-customer point features at
// gis.anaheim.net/electricoutages/ActiveIncidents.cshtml — one point per affected meter; group by the
// incident ID property. official.out = total affected points; no served denominator (config supplies it).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parseAnaheim(raw, opts = {}) {
  const feats = raw && Array.isArray(raw.features) ? raw.features : null;
  if (!feats) throw new Error("anaheim: missing features[]");
  const byId = new Map();
  for (const f of feats) {
    const p = f.properties || {}, g = f.geometry || {};
    const id = String(p.ID != null ? p.ID : (p.id != null ? p.id : ""));
    const co = Array.isArray(g.coordinates) ? g.coordinates : [];
    if (!byId.has(id)) byId.set(id, { count: 0, loc: co.length >= 2 ? [num(co[1]), num(co[0])] : null, etr: (typeof p.ETR === "string" ? p.ETR : (typeof p.etr === "string" ? p.etr : null)) });
    byId.get(id).count++;
  }
  const areas = [...byId].map(([id, v]) => ({ name: `Incident ${id}`, out: v.count, served: v.count, etr: v.etr, loc: v.loc, subs: [] }));
  if (!areas.length) throw new Error("anaheim: no active outages");
  return { official: { out: feats.length, served: num(opts.servedTotal) || feats.length, nOut: byId.size }, areas };
}
