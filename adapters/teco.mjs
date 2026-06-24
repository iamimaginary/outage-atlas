// Tampa Electric (TECO) adapter. micustomer.io Elasticsearch-style tile API (POST). Response:
// { aggregations:{customerCountSum:{value}}, hits:{total:{value}, hits:[{_source:{customerCount,
//   incidentId, estimatedTimeOfRestoration, polygonCenter:[lon,lat], reason, status}}]} }.
// Per-incident grain; no served (system served from config.servedTotal). polygonCenter is [lon,lat].
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

export function parseTeco(raw, opts = {}) {
  const hits = raw && raw.hits && Array.isArray(raw.hits.hits) ? raw.hits.hits : null;
  if (!hits) throw new Error("teco: missing hits.hits");
  const areas = hits.map((h, i) => {
    const s = h._source || {};
    const out = Math.max(0, num(s.customerCount));
    const pc = Array.isArray(s.polygonCenter) ? s.polygonCenter : null;
    return { name: String(s.reason || s.incidentId || `outage #${i}`), out, served: out, etr: typeof s.estimatedTimeOfRestoration === "string" ? s.estimatedTimeOfRestoration : null, loc: pc && pc.length >= 2 ? [num(pc[1]), num(pc[0])] : null, subs: [] };
  });
  if (!areas.length) throw new Error("teco: no incidents");
  const agg = raw.aggregations && raw.aggregations.customerCountSum;
  const out = agg ? Math.max(0, num(agg.value)) : areas.reduce((a, x) => a + x.out, 0);
  const nOut = raw.hits.total && num(raw.hits.total.value) ? num(raw.hits.total.value) : areas.length;
  return { official: { out, served: num(opts.servedTotal) || out, nOut }, areas };
}
