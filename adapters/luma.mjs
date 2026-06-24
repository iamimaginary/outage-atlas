// LUMA adapter (Puerto Rico — LUMA/PREPA). GET outage/regionsWithoutService ->
// { totals:{totalClientsWithoutService,totalClients}, regions:[{name,totalClientsWithoutService,totalClients}] }.
// Region grain WITH served. (ODIN does not cover PR, so this is the only source for Puerto Rico.)
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const clamp = (o, s) => { o = Math.max(0, num(o)); return s > 0 ? Math.min(o, s) : o; };

export function parseLuma(raw) {
  const t = raw && raw.totals;
  const regions = raw && Array.isArray(raw.regions) ? raw.regions : null;
  if (!t || !regions) throw new Error("luma: missing totals/regions");
  const areas = regions.map((r) => { const served = num(r.totalClients); return { name: String(r.name || "(region)"), out: clamp(r.totalClientsWithoutService, served), served, etr: null, loc: null, subs: [] }; });
  if (!areas.length) throw new Error("luma: no regions");
  return { official: { out: Math.max(0, num(t.totalClientsWithoutService)), served: num(t.totalClients) || areas.reduce((a, x) => a + x.served, 0), nOut: areas.filter((a) => a.out > 0).length }, areas };
}
