// GVEA adapter (NISC/Futura "Web Outage Viewer" JSON; Golden Valley Electric, Fairbanks AK). ODIN does
// NOT cover Alaska, so this deep feed is the ONLY outage source for its area. Open JSON, no auth. The
// feed is incident-grained: a system summary (out + served) plus a list of located outages with ETR.
// Per-outage served isn't published, so each area's served floors to its out; the SYSTEM served comes
// from the summary. (Incident-based: a fully calm day has no areas — the collector then skips it.)

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = { summary: <data/outageSummary>, outages: <data/outages array> }
export function parseGvea(raw) {
  const s = raw && raw.summary;
  const outs = raw && Array.isArray(raw.outages) ? raw.outages : [];
  if (!s) throw new Error("gvea: missing outageSummary");
  const areas = outs.map((o, i) => {
    const out = Math.max(0, num(o.customersOutNow != null ? o.customersOutNow : o.customersOutInitially));
    const p = o.outagePoint || {};
    return {
      name: String(o.outageName || o.outageRecID || `outage-${i}`),
      out,
      served: out, // per-outage served not published -> floor to out
      etr: typeof o.estimatedTimeOfRestoral === "string" ? o.estimatedTimeOfRestoral : null,
      loc: (p.lat != null && p.lng != null) ? [num(p.lat), num(p.lng)] : null,
      subs: [],
    };
  });
  const official = { out: num(s.customersOutNow), served: num(s.customersServed), nOut: outs.length };
  return { official, areas };
}
