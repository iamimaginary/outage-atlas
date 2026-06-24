// HECO adapter (Hawaiian Electric: HECO/Oahu + MECO/Maui + HELCO/Hawaii Island, ~95% of Hawaii).
// SCAFFOLD — wired but the config ships DISABLED. HECO's feed is auth-gated (a JWT minted from a
// pre-shared key) AND origin-locked CORS, so it cannot be reached without a HECO-issued credential.
// ODIN does not cover Hawaii at all, so this is the ONLY path to the bulk of the state once a key
// exists. The fetch/handshake lives server-side (collect_utility.fetchHeco / workers/heco-proxy.mjs);
// THIS module is the pure incident-points -> canonical parser (verified against a synthetic golden
// built from the documented response model — refine the per-incident customers field once a real
// authorized payload is captured).
//
// Response model (from the public WASM client): { TotalCustomersAffected, outages:[ { OutageId,
// OutageCause, OutageStatus, EstimatedRestoreTime, Latitude, Longitude, CustomersAffected } ] }.

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const first = (...vals) => { for (const v of vals) if (v != null) return v; return undefined; };

// raw  = HECO outages response. opts = cfg.config (opts.servedTotal sets the system served base).
export function parseHeco(raw, opts = {}) {
  const list = raw && (raw.outages || raw.Outages || (Array.isArray(raw) ? raw : null));
  if (!Array.isArray(list)) throw new Error("heco: missing outages[]");
  const areas = list.map((o, i) => {
    const out = Math.max(0, num(first(o.CustomersAffected, o.customersAffected, o.NumberAffected, o.numberAffected)));
    const lat = num(first(o.Latitude, o.latitude));
    const lon = num(first(o.Longitude, o.longitude));
    const etr = first(o.EstimatedRestoreTime, o.estimatedRestoreTime, o.EstimatedRestoreTimeText);
    const id = first(o.OutageId, o.outageId, o.id) ?? `heco-${i}`;
    return {
      name: `HECO outage #${id}`,
      out,
      served: out, // per-incident served not published -> floor to out
      etr: typeof etr === "string" ? etr : null,
      loc: (lat || lon) ? [lat, lon] : null,
      subs: [],
    };
  });
  const totOut = num(first(raw.TotalCustomersAffected, raw.totalCustomersAffected));
  const sumOut = areas.reduce((a, x) => a + x.out, 0);
  const out = totOut || sumOut;
  const official = { out, served: num(opts.servedTotal) || out, nOut: areas.length };
  return { official, areas };
}
