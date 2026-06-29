// SmartC Mobile / SEDC WidgetAPI adapter (Madison Gas & Electric, …). GET .../WidgetAPI/Outage/
// PreloginGetOutageData?isPlannedOutage=0 -> { result:{ Data:{ listOutageResultSetTwo:[{CustomerAffected,
// Latitude, Longitude, ...}], listTotalOutage:[{TotalCusomerServed}] } } }.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };
export function parseSmartc(raw, opts = {}) {
  const data = raw && raw.result && raw.result.Data ? raw.result.Data : null;
  if (!data) throw new Error("smartc: missing result.Data");
  const list = Array.isArray(data.listOutageResultSetTwo) ? data.listOutageResultSetTwo : [];
  const areas = list.map((o, i) => {
    const out = Math.max(0, num(first(o.CustomerAffected, o.CustomersAffected, o.CustomerAffceted, o.CustAffected)));
    const lat = num(first(o.Latitude, o.Lat)), lon = num(first(o.Longitude, o.Long, o.Lng));
    const etr = first(o.ETR, o.EstimatedRestoration, o.EstRestorationTime);
    return { name: String(first(o.AreaName, o.City, o.Zipcode, o.Area, o.Location) || `outage #${i}`), out, served: out, etr: typeof etr === "string" ? etr : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("smartc: no active outages");
  const tot = data.listTotalOutage && data.listTotalOutage[0] ? data.listTotalOutage[0] : {};
  const served = num(first(tot.TotalCusomerServed, tot.TotalCustomerServed, tot.TotalCustomersServed));
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: served || num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
