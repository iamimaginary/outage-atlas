// AES Indiana (IPL) adapter. Bespoke XML incident feed OMSDATA_OSI.xml: root <OutageData> with repeated
// <Marker> blocks (<IncidentId><CustAffected><Lat><Long><Etr><outageType>) + a headline
// <TotalCustAffected>. Point-incident grain; no served (system served from config.servedTotal).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const tag = (b, t) => { const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1].trim() : null; };

// raw = XML string (or { xml })
export function parseAesIndiana(raw, opts = {}) {
  const xml = typeof raw === "string" ? raw : (raw && raw.xml) || "";
  const blocks = [...xml.matchAll(/<Marker>([\s\S]*?)<\/Marker>/gi)].map((m) => m[1]);
  const areas = blocks.map((b, i) => {
    const out = Math.max(0, num(parseInt(tag(b, "CustAffected"), 10)));
    const lat = num(parseFloat(tag(b, "Lat"))), lon = num(parseFloat(tag(b, "Long")));
    const id = tag(b, "IncidentId") || String(i);
    const etr = tag(b, "Etr");
    return { name: `Outage #${id}`, out, served: out, etr: etr || null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  });
  if (!areas.length) throw new Error("aes-indiana: no markers");
  const hc = parseInt(tag(xml, "TotalCustAffected") || tag(xml, "TotalOut"), 10);
  return { official: { out: Math.max(0, isFinite(hc) ? hc : areas.reduce((a, x) => a + x.out, 0)), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
