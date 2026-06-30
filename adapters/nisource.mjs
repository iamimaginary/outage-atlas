// NIPSCO (NiSource) adapter. Self-hosted LDC API: GET nisource-api/ldc/GetPowerOutages ->
// { outageList:[{affected, cause, city, lat, lng, reported, restore (ETR, ISO), status, zip, ...}],
//   downResponse }. Point grain, already geo-coded (lat/lng). The feed publishes no utility-wide total,
// so official.out is the summed `affected` and served falls back to config.servedTotal. Outages are
// grouped by city for a readable breakdown — the summed total is identical, so the reconciliation gate
// is unaffected. NOTE: NIPSCO is self-hosted now (the historic "Kübra" note is stale).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

export function parseNisource(raw, opts = {}) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.outageList)) throw new Error("nisource: no outageList");
  const byCity = new Map();
  let nOut = 0;
  for (const o of raw.outageList) {
    const out = Math.max(0, toInt(o.affected));
    if (out <= 0) continue;
    nOut++;
    const city = String(o.city || "Unknown").trim() || "Unknown";
    const key = city.toUpperCase();
    const lat = Number(o.lat), lng = Number(o.lng);
    const loc = (isFinite(lat) && isFinite(lng) && (lat || lng)) ? [lat, lng] : null;
    const etr = (typeof o.restore === "string" && o.restore) ? o.restore : null;
    let a = byCity.get(key);
    if (!a) { a = { name: city, out: 0, served: 0, etr: null, loc: null, subs: [] }; byCity.set(key, a); }
    a.out += out;
    if (!a.loc && loc) a.loc = loc;
    if (etr && (!a.etr || etr < a.etr)) a.etr = etr; // earliest ISO restore time for the city
    a.subs.push({ id: `${o.zip || key}-${a.subs.length}`, name: String(o.cause || o.status || "Outage"), out, served: out, etr, loc });
  }
  const areas = [...byCity.values()].map((a) => ({ ...a, served: a.out })).filter((a) => a.out > 0);
  if (!areas.length) throw new Error("nisource: no active outages");
  const out = areas.reduce((s, a) => s + a.out, 0);
  return { official: { out, served: num(opts.servedTotal) || out, nOut }, areas };
}
