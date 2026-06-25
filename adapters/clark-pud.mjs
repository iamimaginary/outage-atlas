// Clark Public Utilities (WA). JSONP at /outage-map/data.js (the collector strips the gksUpdateOutageData(
// ... ) wrapper before this parser). Shape: { totalAffectedCustomerCount, openOutages:[ {key,
// affectedCustomerCount, estimatedRestoration, lat, lng} ] }. No served (system served from config).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parseClarkPud(raw, opts = {}) {
  const res = raw && raw.result ? raw.result : raw; // JSONP payload nests under result
  const outs = res && Array.isArray(res.openOutages) ? res.openOutages : null;
  if (!outs) throw new Error("clark-pud: missing openOutages[]");
  const areas = outs.map((o, i) => {
    const out = Math.max(0, num(o.affectedCustomerCount));
    const lat = num(o.lat), lon = num(o.lng);
    return { name: String(o.key || `outage #${i}`), out, served: out, etr: typeof o.estimatedRestoration === "string" ? o.estimatedRestoration : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("clark-pud: no open outages");
  return { official: { out: Math.max(0, num(raw.totalAffectedCustomerCount)) || areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
