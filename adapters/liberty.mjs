// Liberty Utilities (Empire District, MO/AR/KS/OK and other regions). SmartCMobile CIS backend:
// GET /OutageAPI/api/1/Outage/OutageSummaryCity?companyGroupCode=<grp> -> { data:[ {state, city,
// no_of_incident_percity, customer_affected, customer_served} ] }. One row per city, WITH served.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };
export function parseLiberty(raw, opts = {}) {
  const data = raw && Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : null);
  if (!data) throw new Error("liberty: missing data[]");
  const areas = data.map((r) => {
    const out = Math.max(0, toInt(r.customer_affected));
    const served = toInt(r.customer_served);
    const nm = [r.city, r.state].filter(Boolean).join(", ") || "(city)";
    return { name: nm, out, served: served || out, etr: null, loc: null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("liberty: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.served, 0), nOut: data.reduce((a, r) => a + toInt(r.no_of_incident_percity), 0) || areas.length }, areas };
}
