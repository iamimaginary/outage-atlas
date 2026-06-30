// Dakota Electric Association (MN) adapter. The outage-map page (amp.dakotaelectric.com/outagemap/) is
// server-rendered with the live outages inline as a JS array:
//   var GPSData = [ {x:'..', y:'..', title:'Incident: 341357', cone:'greenCone', info:'<table>...</table>'} ];
// We parse that array out of the HTML: per-incident "Members Impacted" -> out, "Restoration ERT" -> etr.
// The x/y are a projected (non-WGS84) coordinate system we don't transform, so loc stays null (incidents
// are listed but not mapped). No published utility total -> official.out is the summed members; served
// falls back to config.servedTotal.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

// pull a "<td>Label</td><td>Value</td>" cell value out of an incident's info HTML
function cell(html, label) {
  const m = String(html || "").match(new RegExp(`<td>\\s*${label}\\s*</td>\\s*<td[^>]*>([^<]*)</td>`, "i"));
  return m ? m[1].trim() : "";
}

export function parseDakota(raw, opts = {}) {
  const html = typeof raw === "string" ? raw : (raw && typeof raw.html === "string" ? raw.html : "");
  if (!html) throw new Error("dakota: empty HTML");
  const block = html.match(/var\s+GPSData\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!block) throw new Error("dakota: GPSData array not found");
  const objs = block[1].match(/\{[^{}]*\}/g) || []; // each entry has no nested braces
  const areas = [];
  for (const o of objs) {
    const title = (o.match(/title:\s*'([^']*)'/) || [])[1] || "";
    const info = (o.match(/info:\s*'([^']*)'/) || [])[1] || "";
    const out = Math.max(0, toInt(cell(info, "Members Impacted")));
    if (out <= 0) continue;
    const id = (title.match(/(\d+)/) || [])[1] || cell(info, "Outage Alert") || String(areas.length + 1);
    const ert = cell(info, "Restoration ERT");
    areas.push({ name: `Incident ${id}`, out, served: out, etr: ert || null, loc: null, subs: [] });
  }
  if (!areas.length) throw new Error("dakota: no active outages");
  const out = areas.reduce((s, a) => s + a.out, 0);
  return { official: { out, served: num(opts.servedTotal) || out, nOut: areas.length }, areas };
}
