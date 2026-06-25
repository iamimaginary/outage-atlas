// Green Mountain Power (VT). Own .NET API: GET /api/v2/outages/incidents/towns?all=true -> per-town array.
// Field names vary; we match tolerantly and verify live by geography + reconciliation.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };
export function parseGmp(raw, opts = {}) {
  const arr = Array.isArray(raw) ? raw : (raw && (Array.isArray(raw.towns) ? raw.towns : (Array.isArray(raw.data) ? raw.data : null)));
  if (!arr) throw new Error("gmp: missing towns array");
  const areas = arr.map((t, i) => {
    const out = Math.max(0, num(first(t.customers_affected, t.customersAffected, t.customersOut, t.numberOut)));
    const served = num(first(t.total_customers, t.customersServed, t.totalCustomers, t.served));
    const etr = first(t.etr, t.estimatedRestoration, t.estimatedTimeOfRestoration);
    return { name: String(first(t.town_name, t.town, t.name, t.townName) || `town #${i}`), out, served: served || out, etr: typeof etr === "string" ? etr : null, loc: null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("gmp: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + (x.served || x.out), 0), nOut: areas.length }, areas };
}
