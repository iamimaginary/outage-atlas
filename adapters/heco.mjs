// HECO adapter (Hawaiian Electric: HECO/Oahu + MECO/Maui + HELCO/Hawaii Island, ~95% of Hawaii).
// ODIN does not cover Hawaii at all, so this is the ONLY path to the bulk of the state. HECO runs a
// self-hosted .NET/GeoBlazor app (NOT Kübra). The data feed is reached via an ANONYMOUS bearer-token
// chain (no credential): the collector mints a token (GET /api/v1/access-token) then GETs /api/v1/outages
// with it (collect_utility.fetchHeco). THIS module is the pure outages[] -> canonical parser.
//
// Response model (verified live): { outages:[ { outageId, totalCustomersAffected, affectedAreas:[str],
// estimatedRestoreTime, company(0=HECO/Oahu,1=HELCO,2=MECO), geometry:{ coordinates:[ {y:lat,x:lon} ] } } ] }.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };

// raw  = HECO outages response. opts = cfg.config (opts.servedTotal sets the system served base).
export function parseHeco(raw, opts = {}) {
  const list = raw && (raw.outages || raw.Outages || (Array.isArray(raw) ? raw : null));
  if (!Array.isArray(list)) throw new Error("heco: missing outages[]");
  const areas = list.map((o, i) => {
    const out = Math.max(0, num(first(o.totalCustomersAffected, o.TotalCustomersAffected, o.customersAffected, o.CustomersAffected)));
    const aa = Array.isArray(o.affectedAreas) ? o.affectedAreas.filter(Boolean) : [];
    const ring = o.geometry && Array.isArray(o.geometry.coordinates) ? o.geometry.coordinates[0] : null;
    const lat = ring && typeof ring.y === "number" ? ring.y : num(first(o.Latitude, o.latitude));
    const lon = ring && typeof ring.x === "number" ? ring.x : num(first(o.Longitude, o.longitude));
    const etr = first(o.estimatedRestoreTime, o.EstimatedRestoreTime);
    const id = first(o.outageId, o.OutageId, o.id) ?? i;
    return {
      name: aa.length ? aa.join(", ") : `HECO outage #${id}`,
      out,
      served: out, // per-incident served not published -> floor to out
      etr: typeof etr === "string" ? etr : null,
      loc: (lat || lon) ? [lat, lon] : null,
      subs: [],
    };
  });
  if (!areas.length) throw new Error("heco: no outages");
  const out = areas.reduce((a, x) => a + x.out, 0);
  const official = { out, served: num(opts.servedTotal) || out, nOut: areas.length };
  return { official, areas };
}
