// Northern Virginia Electric Cooperative (NOVEC). StormCenter XML: <outages> with per-incident
// <outage numOut="" county="" lat="" lng="" eTime="" cause="" id=""/> elements (attributes, marker grain).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const CO = { PW: "Prince William", FX: "Fairfax", LD: "Loudoun", FQ: "Fauquier", ST: "Stafford", CL: "Clarke", SP: "Spotsylvania", MP: "Manassas Park" };
const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")); return m ? m[1] : null; };
export function parseNovec(raw, opts = {}) {
  const xml = typeof raw === "string" ? raw : (raw && raw.xml) || "";
  const tags = xml.match(/<outage\b[^>]*\/?>/gi) || [];
  const areas = tags.map((t, i) => {
    const out = Math.max(0, num(parseInt(attr(t, "numOut"), 10)));
    const code = (attr(t, "county") || "").trim();
    const lat = num(parseFloat(attr(t, "lat"))), lon = num(parseFloat(attr(t, "lng")));
    const etr = attr(t, "eTime");
    const id = attr(t, "id") || String(i);
    return { name: `${CO[code] || code || "NOVEC"} #${id}`, out, served: out, etr: etr || null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  }).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("novec: no active outages");
  return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
}
