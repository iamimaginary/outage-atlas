// Tucson Electric Power adapter. POST OutageApp/mapfeed (empty body) -> headline string fields
// (AffectedCustomersTEP/CustomerBaseTEP/OutagesCountTEP, comma-formatted) + data.outages[] tagged by
// division. Filter to division=='TEP' (UNS Electric sister divisions are a separate utility). Point grain.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

export function parseTep(raw, opts = {}) {
  if (!raw || typeof raw !== "object") throw new Error("tep: empty");
  const list = (raw.data && Array.isArray(raw.data.outages)) ? raw.data.outages : (Array.isArray(raw.outages) ? raw.outages : []);
  const areas = list.filter((o) => (o.division || "TEP") === "TEP").map((o, i) => {
    const out = Math.max(0, toInt(o.customersOut));
    const b = o.bounds || {};
    const lat = num(Number(b.coordLatCenter)), lon = num(Number(b.coordLngCenter));
    return { name: String(o.updatedCause || o.event || `outage #${i}`), out, served: out, etr: typeof o.formattedEstimatedRestoration === "string" ? o.formattedEstimatedRestoration : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("tep: no active TEP outages");
  return { official: { out: toInt(raw.AffectedCustomersTEP), served: toInt(raw.CustomerBaseTEP) || num(opts.servedTotal), nOut: toInt(raw.OutagesCountTEP) }, areas };
}
