// WEC Energy Group adapter — We Energies (Wisconsin Electric) + Wisconsin Public Service share one OMS:
// a JSON array of outage events at <host>/outagesummary/view/OutageEventJSON. Each event carries a
// Slices[] with AffectedCusts, County and CountyCusts (the served denominator — rare and welcome), plus
// Latitude/Longitude + ETR. We roll events up by county: area.served = CountyCusts (real), system served
// from config.servedTotal. Pure array -> canonical.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const avg = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e5) / 1e5 : null;

// raw = [ event, ... ] (or { events:[...] }); opts.servedTotal sets official.served
export function parseWec(raw, opts = {}) {
  const evs = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.events) ? raw.events : []);
  const byCounty = new Map();
  for (const e of evs) {
    const slices = Array.isArray(e.Slices) ? e.Slices : [];
    const s0 = slices[0] || {};
    const county = String(s0.County || "unknown").trim() || "unknown";
    const out = slices.reduce((a, x) => a + Math.max(0, num(x.AffectedCusts)), 0);
    const lat = num(e.Latitude), lon = num(e.Longitude);
    const etr = typeof e.ETR === "string" ? e.ETR : null;
    if (!byCounty.has(county)) byCounty.set(county, { out: 0, served: 0, subs: [], lats: [], lons: [], etr: null });
    const g = byCounty.get(county);
    g.out += out;
    g.served = Math.max(g.served, num(s0.CountyCusts));
    if (lat || lon) { g.lats.push(lat); g.lons.push(lon); }
    if (!g.etr && etr) g.etr = etr;
    g.subs.push({ id: `${county}|${g.subs.length}`, name: String(s0.City || county), out, served: num(s0.CityCusts) || out, etr, loc: (lat || lon) ? [lat, lon] : null });
  }
  const areas = [...byCounty].map(([name, g]) => ({ name, out: g.out, served: g.served || g.out, etr: g.etr, loc: g.lats.length ? [avg(g.lats), avg(g.lons)] : null, subs: g.subs }));
  if (!areas.length) throw new Error("wec: no outage events");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.served, 0), nOut: evs.length }, areas };
}
