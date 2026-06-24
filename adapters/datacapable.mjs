// DataCapable / UtiliSocial adapter (Seattle City Light, Duquesne Light, …). GET <eventsUrl> returns a
// FLAT JSON array of per-outage events; no served denominator (system served from config.servedTotal).
// etrTime is epoch-ms. Each event is a located point -> one canonical area.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const etrVal = (v) => { if (typeof v === "string" && v.trim()) return v; if (typeof v === "number" && v > 0) { try { return new Date(v).toISOString(); } catch { return null; } } return null; };

// raw = [ {id,numPeople,latitude,longitude,etrTime,city,state,identifier,...}, ... ]; opts.servedTotal
export function parseDatacapable(raw, opts = {}) {
  const evs = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.events) ? raw.events : null);
  if (!evs) throw new Error("datacapable: missing events array");
  let tot = 0;
  const areas = evs.map((e, i) => {
    const out = Math.max(0, num(e.numPeople)); tot += out;
    const city = e.city && String(e.city).trim();
    const lat = num(e.latitude), lon = num(e.longitude);
    return { name: city ? `${city}, ${e.state || ""}`.replace(/,\s*$/, "") : String(e.identifier || e.id || `outage #${i}`), out, served: out, etr: etrVal(e.etrTime), loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  });
  if (!areas.length) throw new Error("datacapable: no events");
  return { official: { out: tot, served: num(opts.servedTotal) || tot, nOut: evs.length }, areas };
}
