// SMUD adapter (Sacramento Municipal Utility District). Self-hosted "OMK" feed on usage.smud.org/omkml.
// We use the per-community JSON summary (cleaner than the parallel KML): GET .../api/communitylist/ ->
// { returndata:[ {Title,OutageCount,CustomersImpacted,GeocenterLat,GeocenterLong} ] } where
// returndata[0] (Title "SMUD") is the system rollup and the rest are per-community. No served denominator.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = { returndata:[...] }; opts.servedTotal sets official.served
export function parseSmud(raw, opts = {}) {
  const rows = raw && Array.isArray(raw.returndata) ? raw.returndata : null;
  if (!rows) throw new Error("smud: missing returndata[]");
  const sys = rows.find((r) => String(r.Title || "").trim().toUpperCase() === "SMUD") || rows[0];
  const areas = rows.filter((r) => r !== sys).map((r) => {
    const out = Math.max(0, num(r.CustomersImpacted));
    const lat = num(r.GeocenterLat), lon = num(r.GeocenterLong);
    return { name: String(r.Title || "(community)"), out, served: out, etr: null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("smud: no active outages");
  return { official: { out: Math.max(0, num(sys.CustomersImpacted)) || areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: Math.max(0, num(sys.OutageCount)) || areas.length }, areas };
}
