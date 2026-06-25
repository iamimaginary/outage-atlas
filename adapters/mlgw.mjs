// Memphis Light, Gas & Water (MLGW). GeoJSON FeatureCollection of per-outage Point features at
// outagemap.mlgw.org/geojson.php (needs a browser UA; F5 ASM rejects default curl UA). No served per feature.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parseMlgw(raw, opts = {}) {
  const feats = raw && Array.isArray(raw.features) ? raw.features : null;
  if (!feats) throw new Error("mlgw: missing features[]");
  const areas = feats.map((f, i) => {
    const p = f.properties || {}, g = f.geometry || {};
    const co = Array.isArray(g.coordinates) ? g.coordinates : [];
    const out = Math.max(0, num(p.CUR_CUST_AFF));
    const etr = (typeof p.EST_REPAIR_TIME === "string" && p.EST_REPAIR_TIME.trim()) ? p.EST_REPAIR_TIME : null;
    return { name: String(p.IMPACT || p.OUTAGE_NO || `outage #${i}`), out, served: out, etr, loc: co.length >= 2 ? [num(co[1]), num(co[0])] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("mlgw: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
