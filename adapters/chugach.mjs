// Chugach adapter (custom JSON; Chugach Electric Association, Anchorage AK). ODIN does NOT cover Alaska,
// so this deep feed is the only outage source for its area. Two open JSON files (served as .js but with
// pure-JSON bodies): Grids.js = per-section out + served (the canonical areas, WITH served); Incidents.js
// = located points + ETR (used for the outage count). (Section-based: a calm day has no grids -> the
// collector then skips it.)

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = { grids: <Grids.js {Items:[{SECTIONMAP,CUST_OUT,CUST_SERVED}]}>, incidents: <Incidents.js {Items:[...]}> }
export function parseChugach(raw) {
  const grids = raw && raw.grids && Array.isArray(raw.grids.Items) ? raw.grids.Items : [];
  const inc = raw && raw.incidents && Array.isArray(raw.incidents.Items) ? raw.incidents.Items : [];
  const areas = grids.map((g) => {
    const served = Math.max(0, num(g.CUST_SERVED));
    const out = Math.max(0, num(g.CUST_OUT));
    return { name: String(g.SECTIONMAP || "(section)"), out: served > 0 ? Math.min(out, served) : out, served, etr: null, loc: null, subs: [] };
  });
  if (!areas.length) throw new Error("chugach: no grid sections (no active outages)");
  const official = {
    out: areas.reduce((a, x) => a + x.out, 0),
    served: areas.reduce((a, x) => a + x.served, 0),
    nOut: inc.length,
  };
  return { official, areas };
}
