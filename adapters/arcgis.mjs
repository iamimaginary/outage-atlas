// Generic Esri ArcGIS adapter. Many utilities (SCE, Entergy, …) back their outage map with a public
// ArcGIS FeatureServer/MapServer whose feature attributes vary in NAME only — so unlike a per-vendor
// parser, this one is CONFIG-DRIVEN: utilities/<id>.json supplies the attribute field names. THIS module
// is the pure part: raw ArcGIS query response -> canonical. The fetch/pagination lives in the collector.
//
// config.config.fields maps canonical -> ArcGIS attribute name:
//   { out:"EST_CUSTOMERS", etr:"CURRENT_ETOR_TEXT", id:"OUTAGE_ID",
//     name:"COUNTY"|null,           // optional place name for per-area naming
//     lat:"OUTAGE_LATITUDE"|null, lon:"OUTAGE_LONGITUDE"|null }   // optional; else geometry is used
// config.config.groupBy = an attribute name to roll incidents up into areas (e.g. "COUNTY"); omit for
// per-incident areas. config.config.servedTotal sets official.served (these feeds omit served, so each
// area's served floors to its out and the SYSTEM total comes from config).

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const r5 = (n) => Math.round(n * 1e5) / 1e5;
function webMercToLatLon(x, y) {
  if (!isFinite(x) || !isFinite(y)) return null;
  const R = 20037508.342789244;
  const lon = (x / R) * 180;
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(((y / R) * 180) * Math.PI / 180)) - Math.PI / 2);
  return [r5(lat), r5(lon)];
}
function pointLoc(a, g, F) {
  if (F.lat && a[F.lat] != null && a[F.lon] != null) return [num(a[F.lat]), num(a[F.lon])];
  if (g && g.x != null && g.y != null) return (Math.abs(g.x) <= 180 && Math.abs(g.y) <= 90) ? [r5(num(g.y)), r5(num(g.x))] : webMercToLatLon(num(g.x), num(g.y));
  return null;
}
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
// ETR may be a formatted string (SCE "ERT") or epoch-ms (Entergy "etrdate") -> normalize to a string.
const etrVal = (v) => {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && isFinite(v) && v > 0) { try { return new Date(v).toISOString(); } catch { return null; } }
  return null;
};

// raw = ArcGIS query response { features:[{attributes,geometry}] }; opts = cfg.config
export function parseArcgis(raw, opts = {}) {
  const F = opts.fields || {};
  const outF = F.out || "EST_CUSTOMERS";
  const feats = raw && Array.isArray(raw.features) ? raw.features : null;
  if (!feats) throw new Error("arcgis: missing features[]");
  const incident = (f, i) => {
    const a = f.attributes || {};
    return {
      out: Math.max(0, num(a[outF])),
      etr: F.etr ? etrVal(a[F.etr]) : null,
      id: String((F.id && a[F.id] != null ? a[F.id] : a.OBJECTID) ?? i),
      loc: pointLoc(a, f.geometry, F),
      name: F.name && a[F.name] != null ? String(a[F.name]).trim() : null,
    };
  };
  let areas;
  if (opts.groupBy) {
    const groups = new Map();
    feats.forEach((f, i) => { const inc = incident(f, i); const k = (f.attributes && String(f.attributes[opts.groupBy] ?? "").trim()) || "Unknown"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(inc); });
    areas = [...groups].map(([name, items]) => {
      const subs = items.map((m) => ({ id: m.id, name: `${name} #${m.id}`, out: m.out, served: m.out, etr: m.etr, loc: m.loc }));
      const etrs = subs.map((s) => s.etr).filter(Boolean).sort();
      const locs = subs.map((s) => s.loc).filter(Boolean);
      const out = subs.reduce((s, x) => s + x.out, 0);
      return { name, out, served: out, etr: etrs.length ? etrs[etrs.length - 1] : null, loc: locs.length ? [r5(avg(locs.map((l) => l[0]))), r5(avg(locs.map((l) => l[1])))] : null, subs };
    });
  } else {
    areas = feats.map((f, i) => { const m = incident(f, i); return { name: m.name || `outage #${m.id}`, out: m.out, served: m.out, etr: m.etr, loc: m.loc, subs: [] }; });
  }
  const totOut = areas.reduce((a, x) => a + x.out, 0);
  const official = { out: totOut, served: num(opts.servedTotal) || totOut, nOut: feats.length };
  return { official, areas };
}
