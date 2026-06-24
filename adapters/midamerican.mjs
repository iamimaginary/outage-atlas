// MidAmerican Energy adapter. POST OutageWatch/api/County/CountyInfo/ (empty body) -> array of counties
// [{CountyNam,NumOutages,PremiseCount}] WITH served (PremiseCount). Areas = counties with active outages;
// system served from config.servedTotal (the feed only lists affected counties).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const clamp = (o, s) => { o = Math.max(0, num(o)); return s > 0 ? Math.min(o, s) : o; };

export function parseMidamerican(raw, opts = {}) {
  const rows = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : null);
  if (!rows) throw new Error("midamerican: missing county array");
  const areas = rows.map((c) => { const served = num(c.PremiseCount); return { name: String(c.CountyNam || "(county)"), out: clamp(c.NumOutages, served), served, etr: null, loc: null, subs: [] }; }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("midamerican: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.served, 0), nOut: areas.length }, areas };
}
