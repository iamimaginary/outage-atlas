// Idaho Power adapter. GET .../Outage/GetCurrentOutageInformation ->
// { object:{ outages:[{omsCustomerCount, outageCity:[{outageCityName}], omsFeederName,
//   omsEstimatedOutageRestorationDate, latitude, longitude}], totalCustomersAffected } }.
// Per-outage points; no served denominator (system served from config.servedTotal).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

export function parseIdahoPower(raw, opts = {}) {
  const obj = raw && raw.object;
  const outs = obj && Array.isArray(obj.outages) ? obj.outages : null;
  if (!obj || !outs) throw new Error("idaho-power: missing object.outages");
  const areas = outs.map((o, i) => {
    const cities = Array.isArray(o.outageCity) ? o.outageCity.map((c) => c.outageCityName).filter(Boolean) : [];
    const out = Math.max(0, num(o.omsCustomerCount));
    const lat = num(o.latitude), lon = num(o.longitude);
    return { name: cities.length ? cities.join(" / ") : String(o.omsFeederName || `outage #${i}`), out, served: out, etr: typeof o.omsEstimatedOutageRestorationDate === "string" ? o.omsEstimatedOutageRestorationDate : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  });
  if (!areas.length) throw new Error("idaho-power: no outages");
  return { official: { out: Math.max(0, num(obj.totalCustomersAffected)) || areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: outs.length }, areas };
}
