// KIUC adapter (NISC "Hosted Outage Map" static JSON; Kauai Island Utility Cooperative, HI). ODIN does
// NOT cover Hawaii, so this deep feed is the only outage source for Kauai. One open, CORS:* summary.json
// carries the system total AND a per-region (county + ZIP) breakdown WITH served counts. We use the
// county-grain region set for canonical areas (each carries out + served); incident x/y are in a
// projected SR and aren't needed at region grain, so subs are left empty.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = summary.json: { totalServed, outages:[...], regionDataSets:[{id,regions:[{id,numberOut,numberServed}]}] }
export function parseKiuc(raw) {
  if (!raw || typeof raw !== "object") throw new Error("kiuc: empty summary");
  const sets = Array.isArray(raw.regionDataSets) ? raw.regionDataSets : [];
  const county = sets.find((s) => s.id === "omscounty") || sets[0];
  const regions = county && Array.isArray(county.regions) ? county.regions : [];
  const areas = regions.map((r) => {
    const served = Math.max(0, num(r.numberServed));
    const out = Math.max(0, num(r.numberOut));
    return { name: String(r.id || "(region)"), out: served > 0 ? Math.min(out, served) : out, served, etr: null, loc: null, subs: [] };
  });
  if (!areas.length) throw new Error("kiuc: no regions in summary");
  const official = {
    out: areas.reduce((a, x) => a + x.out, 0),
    served: num(raw.totalServed) || areas.reduce((a, x) => a + x.served, 0),
    nOut: Array.isArray(raw.outages) ? raw.outages.length : areas.filter((x) => x.out > 0).length,
  };
  return { official, areas };
}
