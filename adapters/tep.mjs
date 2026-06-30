// Tucson Electric Power / UniSource adapter. POST OutageApp/mapfeed (empty body) -> headline string
// fields suffixed by division (AffectedCustomers<DIV>/CustomerBase<DIV>/OutagesCount<DIV>, comma-formatted)
// + data.outages[] tagged by division. One feed carries three divisions: TEP (Tucson Electric Power),
// USE (UNS Electric), UEE (UNS Energy) — each a SEPARATE utility. opts.division (default "TEP") selects
// which one this config collects. Point grain.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

export function parseTep(raw, opts = {}) {
  if (!raw || typeof raw !== "object") throw new Error("tep: empty");
  const div = opts.division || "TEP";
  const list = (raw.data && Array.isArray(raw.data.outages)) ? raw.data.outages : (Array.isArray(raw.outages) ? raw.outages : []);
  const areas = list.filter((o) => (o.division || "TEP") === div).map((o, i) => {
    const out = Math.max(0, toInt(o.customersOut));
    const b = o.bounds || {};
    const lat = num(Number(b.coordLatCenter)), lon = num(Number(b.coordLngCenter));
    return { name: String(o.updatedCause || o.event || `outage #${i}`), out, served: out, etr: typeof o.formattedEstimatedRestoration === "string" ? o.formattedEstimatedRestoration : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error(`tep: no active ${div} outages`);
  return { official: { out: toInt(raw[`AffectedCustomers${div}`]), served: toInt(raw[`CustomerBase${div}`]) || num(opts.servedTotal), nOut: toInt(raw[`OutagesCount${div}`]) }, areas };
}
