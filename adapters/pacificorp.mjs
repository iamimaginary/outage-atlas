// PacifiCorp adapter (Pacific Power: OR/WA/CA + Rocky Mountain Power: UT/WY/ID — one company, six state
// files). Self-hosted AEM JSON at www.pacificpower.net/etc/pcorp/datafiles/outagemap/map<STATE>.json
// (the outages.*/outagemap.* subdomains are egress-blocked; the www CMS host serves the same feed).
// Per-incident points keyed by zip; the feed has no served denominator -> per-area served floors to out
// and the SYSTEM served comes from config.servedTotal. The collector fetches all six state files.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = { states: [ <map<STATE>.json>, ... ] }; opts.servedTotal sets official.served
export function parsePacificorp(raw, opts = {}) {
  const files = raw && Array.isArray(raw.states) ? raw.states : [];
  let totOut = 0;
  const areas = [];
  for (const f of files) {
    for (const o of (f && Array.isArray(f.outages) ? f.outages : [])) {
      const out = Math.max(0, num(o.custOut != null ? o.custOut : o.outCount));
      totOut += out;
      const lat = num(o.latitude), lon = num(o.longitude);
      areas.push({
        name: String(o.zip || "(area)").trim() || "(area)",
        out, served: out,
        etr: typeof o.etr === "string" ? o.etr : null,
        loc: (lat || lon) ? [lat, lon] : null,
        subs: [],
      });
    }
  }
  if (!areas.length) throw new Error("pacificorp: no outages across state files");
  return { official: { out: totOut, served: num(opts.servedTotal) || totOut, nOut: areas.length }, areas };
}
