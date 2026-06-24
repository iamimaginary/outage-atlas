// AES Ohio (Dayton Power & Light) adapter. Bespoke XML incident feed (DPLOMSDATA.xml): repeated
// <Markers> blocks with <LAT><LNG><TOTALCUSTS><INCIDENTID><COUNTY><OutageTime><EstimateTime>. No JSON
// and no served denominator -> per-area served floors to out, system served from config.servedTotal.
// Pure XML-string -> canonical, grouped by county. (Lightweight tag extraction — the feed is flat.)

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const tag = (block, t) => { const m = block.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1].trim() : null; };

// raw = XML string (or { xml }); opts.servedTotal sets official.served
export function parseAesOhio(raw, opts = {}) {
  const xml = typeof raw === "string" ? raw : (raw && raw.xml) || "";
  const blocks = [...xml.matchAll(/<Markers>([\s\S]*?)<\/Markers>/gi)].map((m) => m[1]);
  const byCounty = new Map();
  for (const b of blocks) {
    const out = Math.max(0, num(parseInt(tag(b, "TOTALCUSTS"), 10)));
    const county = String(tag(b, "COUNTY") || "unknown").trim() || "unknown";
    const lat = num(parseFloat(tag(b, "LAT"))), lon = num(parseFloat(tag(b, "LNG")));
    const etr = tag(b, "EstimateTime");
    const id = tag(b, "INCIDENTID") || "";
    if (!byCounty.has(county)) byCounty.set(county, []);
    byCounty.get(county).push({ id: String(id), name: `${county} #${id}`, out, served: out, etr: etr || null, loc: (lat || lon) ? [lat, lon] : null });
  }
  const areas = [...byCounty].map(([name, subs]) => ({
    name, out: subs.reduce((a, x) => a + x.out, 0), served: subs.reduce((a, x) => a + x.out, 0),
    etr: subs.map((s) => s.etr).filter(Boolean)[0] || null, loc: subs.map((s) => s.loc).filter(Boolean)[0] || null, subs,
  }));
  if (!areas.length) throw new Error("aes-ohio: no markers");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: blocks.length }, areas };
}
