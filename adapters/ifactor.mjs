// iFactor adapter — the LEGACY (pre-modern) Kübra Storm Center used by Con Edison and Eversource. Data
// is static JSON: metadata.json (a pointer to a timestamped directory) -> that dir holds data.json (the
// summary totals) + report_*.json (a variable-depth area tree: root/borough/neighborhood for ConEd,
// company/state/region/town for Eversource). Shape mirrors the modern report (cust_a.val / cust_s /
// area_name / nested areas[]) but with NO coordinates and the totals living in data.json, not the
// reports. Open + CORS:* + no auth. The fetch (metadata -> dir -> data.json + reports) lives in the
// collector; THIS module is the pure part.
//
// Flatten to canonical areas->subs by taking each LEAF's immediate PARENT as an area and the leaves as
// its subs — uniform across depths (ConEd boroughs+neighborhoods, Eversource regions+towns) and it
// reconciles: summed area out == data.json total.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const hasVal = (c) => c && typeof c.val === "number" && isFinite(c.val);
const nodeOut = (n) => hasVal(n.cust_a) ? n.cust_a.val : num(n.cust_a);
const sane = (val, served) => { const o = Math.max(0, num(val)); return served > 0 ? Math.min(o, served) : o; };

// group leaves under their immediate parent: acc[parentName] = { node:parent, subs:[leaf,...] }
function collect(node, parent, acc) {
  const kids = (node.areas || []).filter((k) => k && typeof k === "object");
  if (!kids.length) {
    const owner = parent || node;                 // a top-level leaf becomes its own area
    const key = owner.area_name || "(area)";
    if (!acc.has(key)) acc.set(key, { node: owner, subs: [] });
    if (parent) acc.get(key).subs.push(node);
    return;
  }
  for (const k of kids) collect(k, node, acc);
}

// raw = { summary:<data.json>, reports:[<report_*.json>...] }
export function parseIfactor(raw) {
  const sm = raw && raw.summary && raw.summary.summaryFileData;
  if (!sm) throw new Error("ifactor: missing summary.summaryFileData");
  const acc = new Map();
  for (const rep of (Array.isArray(raw.reports) ? raw.reports : [])) {
    const fd = rep && (rep.file_data || rep);
    for (const top of (fd && Array.isArray(fd.areas) ? fd.areas : [])) collect(top, null, acc);
  }
  const areas = [];
  for (const [name, { node, subs }] of acc) {
    const subAreas = subs.map((s) => {
      const served = num(s.cust_s);
      return { id: `${name}|${s.area_name || "?"}`, name: String(s.area_name || "(area)"), out: sane(nodeOut(s), served), served, etr: s.etr || null, loc: null };
    });
    const served = num(node.cust_s) || subAreas.reduce((a, x) => a + x.served, 0);
    const out = sane(hasVal(node.cust_a) ? node.cust_a.val : subAreas.reduce((a, x) => a + x.out, 0), served);
    areas.push({ name: String(name), out, served, etr: node.etr || null, loc: null, subs: subAreas });
  }
  if (!areas.length) throw new Error("ifactor: no areas");
  const official = { out: Math.max(0, hasVal(sm.total_cust_a) ? sm.total_cust_a.val : num(sm.total_cust_a)), served: num(sm.total_cust_s), nOut: num(sm.total_outages) };
  return { official, areas };
}
