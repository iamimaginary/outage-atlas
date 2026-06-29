// DataVoice/Milsoft "OutageEntry" SaaS adapter (outageentry.com; Glendale W&P, Walton EMC, Shenandoah
// Valley EC, …). The collector POSTs action=get&client=<slug>&target=cfa_device_markers&serviceIndex=1
// -> { result, "0":{ markers:[ {consumers_affected, lat, lon, incident_id, formatted_ert, substation,
// feeder} ] } }. Per-outage points; no served denominator (system served from config).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
export function parseOutageentry(raw, opts = {}) {
  const m = raw && raw["0"] && Array.isArray(raw["0"].markers) ? raw["0"].markers : null;
  if (!m) throw new Error("outageentry: missing [0].markers");
  const areas = m.map((o, i) => {
    const out = Math.max(0, num(parseInt(o.consumers_affected, 10)));
    const lat = num(parseFloat(o.lat)), lon = num(parseFloat(o.lon));
    const etr = o.formatted_ert || o.estimated_restore_time;
    const label = o.incident_id || (o.substation ? `Sub ${o.substation}/Fdr ${o.feeder || ""}`.trim() : `outage #${i}`);
    return { name: String(label), out, served: out, etr: typeof etr === "string" ? etr : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("outageentry: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
