// Milsoft "Web Outage Viewer" static-JSON adapter — a common cooperative OMS format served per-utility
// at <host>/data/{boundaries.json | outages.json}. Two shapes, both handled:
//  - boundaries.json: [{ name, nameField, boundaries:[{name, customersAffected, customersOutNow, customersServed}] }]
//    -> county-grain areas WITH served (South Central, Flint, NGEMC, Bluebonnet).
//  - outages.json: [{ outageRecID, outageName, outagePoint:{lat,lng}, estimatedTimeOfRestoral,
//    customersOutNow, customersOutInitially }] -> per-outage points (Horry, First Electric).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

export function parseMilsoft(raw, opts = {}) {
  // county-boundaries shape
  if (Array.isArray(raw) && raw[0] && Array.isArray(raw[0].boundaries)) {
    const areas = [];
    for (const grp of raw) {
      for (const b of (grp.boundaries || [])) {
        const served = Math.max(0, num(b.customersServed));
        const out = Math.max(0, num(b.customersOutNow != null ? b.customersOutNow : b.customersAffected));
        if (served <= 0 && out <= 0) continue;
        areas.push({ name: String(b.name || "(area)"), out: served > 0 ? Math.min(out, served) : out, served, etr: null, loc: null, subs: [] });
      }
    }
    if (!areas.length) throw new Error("milsoft: no boundary areas");
    return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.served, 0), nOut: areas.filter((a) => a.out > 0).length }, areas };
  }
  // per-outage shape
  if (Array.isArray(raw)) {
    const areas = raw.map((o, i) => {
      const out = Math.max(0, num(o.customersOutNow != null ? o.customersOutNow : o.customersOutInitially));
      const p = o.outagePoint || {};
      const lat = num(p.lat), lon = num(p.lng);
      return { name: String(o.outageName || o.outageRecID || `outage #${i}`), out, served: out, etr: typeof o.estimatedTimeOfRestoral === "string" ? o.estimatedTimeOfRestoral : null, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
    }).filter((a) => a.out > 0);
    if (!areas.length) throw new Error("milsoft: no active outages");
    return { official: { out: areas.reduce((a, x) => a + x.out, 0), served: num(opts.servedTotal) || areas.reduce((a, x) => a + x.out, 0), nOut: areas.length }, areas };
  }
  throw new Error("milsoft: unrecognized shape");
}
