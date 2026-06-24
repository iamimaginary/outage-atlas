// Kübra StormCenter adapter. Kübra hosts FirstEnergy AND a large share of US utilities behind the
// same API shape, so this one parser generalizes to many utilities — only utilities/<id>.json changes
// (instance/view/referer). This module is the PURE part: raw report.json -> canonical model. The
// fetch orchestration (currentState -> configuration -> report) lives in the collector; this is what
// breaks when Kübra changes their schema, so it's isolated here and golden-tested against fixtures.
//
// Fix loop for an agent: a failing snapshot auto-captures the raw report to adapters/fixtures/kubra/.
// Reproduce with `node scripts/test_adapters.mjs`, edit parseKubraReport until the fixture passes the
// schema + expected output, open a PR. The reconciliation CI gate guards against a wrong-but-passing fix.
//
// MULTI-REGION: a Kübra report's file_data.areas may hold ONE top-level area (FirstEnergy = "OHIO" ->
// counties -> townships, a 3-level tree) OR MANY (Dominion = 7 regions -> leaves, a 2-level tree). We
// iterate ALL of fd.areas and normalize both to the canonical areas->subs (2-level): where a top-level
// area has grandchildren we promote its children to canonical "areas" (dropping the state wrapper);
// otherwise the top-level area itself is canonical. An area's out/served use its own cust_a/cust_s when
// present, else the sum of its subs — so summed areas reconcile with the utility's official total.
// (Reading only fd.areas[0], as an earlier version did, undercounted multi-region utilities — the
// reconciliation gate caught it in the spike: Dominion summed 274 vs official 1979.)

// out can never be negative or exceed served (Kübra occasionally returns masked/garbage values)
const sane = (val, served) => { const o = (typeof val === "number" && isFinite(val)) ? Math.max(0, val) : 0; return served > 0 ? Math.min(o, served) : o; };
// bbox [W_lon, S_lat, E_lon, N_lat] -> [lat, lon] centroid
const centroid = (b) => (b && b.length === 4) ? [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2] : null;
const hasVal = (c) => c && typeof c.val === "number" && isFinite(c.val);

// build a canonical sub-area; id falls back to "<parentName>|<name>" when Kübra omits areaId
function mkSub(parentName, s) {
  const served = s.cust_s || 0;
  return {
    id: s.areaId || (parentName + "|" + s.name),
    name: s.name,
    out: sane(hasVal(s.cust_a) ? s.cust_a.val : 0, served),
    served,
    etr: s.etr || null,
    loc: centroid(s.gotoMap && s.gotoMap.bbox)
  };
}

// build a canonical top-level area from a Kübra node + its child nodes (the subs)
function mkArea(node) {
  const subs = (node.areas || []).map((s) => mkSub(node.name, s));
  const served = (typeof node.cust_s === "number" && node.cust_s) ? node.cust_s : subs.reduce((a, x) => a + x.served, 0);
  const rawOut = hasVal(node.cust_a) ? node.cust_a.val : subs.reduce((a, x) => a + x.out, 0);
  return { name: node.name, out: sane(rawOut, served), served, etr: node.etr || null, loc: centroid(node.gotoMap && node.gotoMap.bbox), subs };
}

// raw Kübra report.json -> { official, areas } (canonical). Throws on a structurally empty report.
export function parseKubraReport(report) {
  const fd = report && report.file_data;
  if (!fd || !Array.isArray(fd.areas) || !fd.areas.length) throw new Error("kubra: report.file_data.areas missing/empty");
  const tot = fd.totals || {};
  const areas = [];
  for (const top of fd.areas) {
    const children = top.areas || [];
    const hasGrandchildren = children.some((c) => Array.isArray(c.areas) && c.areas.length);
    if (hasGrandchildren) for (const c of children) areas.push(mkArea(c)); // 3-level: promote children (counties)
    else areas.push(mkArea(top));                                          // 2-level: the top is the area (region)
  }
  const official = { out: hasVal(tot.cust_a) ? tot.cust_a.val : 0, served: tot.cust_s || 0, nOut: tot.n_out || 0 };
  return { official, areas };
}
