// Portland General Electric (OR). Custom public GraphQL (Apigee, no auth for outage queries). The
// collector POSTs the getOutagesByCounty query; this parses { data:{ getOutagesByCounty:[ {county,
// totalCustomersImpacted, zipCodeInfo:[{zipCode,lat,long,totalCustomersEffected}] } ] } }. (PGE's field
// spelling "totalCustomersEffected" is preserved verbatim.)
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parsePge2(raw, opts = {}) {
  let list = raw && raw.data && raw.data.getOutagesByCounty;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { /* leave as-is */ } }
  if (!Array.isArray(list)) throw new Error("pge-graphql: missing data.getOutagesByCounty[]");
  const areas = list.map((c) => {
    const out = Math.max(0, num(c.totalCustomersImpacted));
    const subs = (Array.isArray(c.zipCodeInfo) ? c.zipCodeInfo : []).map((z) => {
      const lat = num(z.lat), lon = num(z.long);
      return { id: String(z.zipCode || ""), name: String(z.zipCode || "(zip)"), out: Math.max(0, num(z.totalCustomersEffected)), served: Math.max(0, num(z.totalCustomersEffected)), etr: null, loc: (lat || lon) ? [lat, lon] : null };
    });
    return { name: String(c.county || "(county)"), out, served: out, etr: null, loc: null, subs };
  }).filter((a) => a.out > 0 || a.subs.length);
  if (!areas.length) throw new Error("pge-graphql: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
