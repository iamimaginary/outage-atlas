// Siena Technologies "WebSurv / OMS" adapter (United Power, …). POST <host>/Outages/Home/UpdatePushpin
// -> XML <NewDataSet><OMSCASES> per incident: <SERIAL><CURCUST><INITCUST><AVGLAT><AVGLONG><RESTORETIM>
// <PLANNED><DESC_CAUSE>. Per-incident points; no served denominator (system served from config).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const tag = (b, t) => { const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1].trim() : null; };
export function parseSienatech(raw, opts = {}) {
  const xml = typeof raw === "string" ? raw : (raw && raw.xml) || "";
  const cases = [...xml.matchAll(/<OMSCASES>([\s\S]*?)<\/OMSCASES>/gi)].map((m) => m[1]);
  const areas = cases.map((c, i) => {
    const out = Math.max(0, num(parseInt(tag(c, "CURCUST") || tag(c, "INITCUST"), 10)));
    const lat = num(parseFloat(tag(c, "AVGLAT"))), lon = num(parseFloat(tag(c, "AVGLONG")));
    const etr = tag(c, "RESTORETIM");
    const id = (tag(c, "SERIAL") || String(i)).replace(/^\*/, "");
    return { name: `Outage #${id}`, out, served: out, etr: etr || null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("sienatech: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
