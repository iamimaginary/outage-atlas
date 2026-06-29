// ACS/Minsait "GridVu Public" OMS adapter (Lubbock LP&L, Lansing BWL, …). GET
// <host>/GridVuServer/Public/getAllOutages -> { outageLst:[ {custAffected, lat, lon, etr, subst, fd,
// idf, planned, status} ] }. Per-outage points; no served denominator (system served from config).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };
export function parseGridvu(raw, opts = {}) {
  const list = raw && Array.isArray(raw.outageLst) ? raw.outageLst : null;
  if (!list) throw new Error("gridvu: missing outageLst");
  const areas = list.map((o, i) => {
    const out = Math.max(0, num(first(o.custAffected, o.customersAffected, o.numCust, o.custaffected)));
    const lat = num(first(o.lat, o.latitude)), lon = num(first(o.lon, o.lng, o.longitude));
    const etr = first(o.etr, o.estimatedRestoration);
    return { name: String(first(o.subst, o.fd, o.idf) || `outage #${i}`), out, served: out, etr: typeof etr === "string" ? etr : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("gridvu: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
