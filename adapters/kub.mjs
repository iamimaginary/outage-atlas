// Knoxville Utilities Board (TN). Own API /api/outage/v1/electric-outages. Per-incident points +
// an electricOutageInfo headline (totalElectricCustomers / electricCustomersWithoutPower).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parseKub(raw, opts = {}) {
  const list = raw && Array.isArray(raw.electricOutage) ? raw.electricOutage : null;
  if (!list) throw new Error("kub: missing electricOutage[]");
  const areas = list.map((o, i) => {
    const out = Math.max(0, num(parseInt(o.customerCount, 10)));
    const lat = num(o.y), lon = num(o.x); // x,y look like lon,lat in WGS84 on this feed
    const etr = (o.ertProvided === true && typeof o.estimatedRestoreTime === "string") ? o.estimatedRestoreTime : null;
    return { name: `Outage ${o.id != null ? o.id : i}`, out, served: out, etr, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("kub: no active outages");
  const info = raw.electricOutageInfo && raw.electricOutageInfo[0] ? raw.electricOutageInfo[0] : {};
  return {
    official: {
      out: Math.max(0, num(info.electricCustomersWithoutPower)) || areas.reduce((a, x) => a + x.out, 0),
      served: num(info.totalElectricCustomers) || num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0),
      nOut: (raw.meta && num(raw.meta.total)) || areas.length,
    }, areas,
  };
}
