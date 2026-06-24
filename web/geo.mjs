// Location resolution — the "find my location" pipeline. Pure-ish ESM that runs IDENTICALLY in the
// browser and in Node 20 (both have global fetch), so scripts/test_geo.mjs can exercise it headless.
// All endpoints are free and CORS-open (verified in the Phase -1 spike + Phase 2):
//   geocode:  api.zippopotam.us (ZIP)  -> lat,lon
//   county:   geo.fcc.gov/api/census/area (lat,lon -> FIPS)
//   utility:  HIFLD Electric Retail Service Territories FeatureServer (lat,lon -> serving utility[ies])
//
// Everything returns plain data; the UI layer (index.html) renders it. No secrets, no PII stored.

const ZIPPOPOTAM = "https://api.zippopotam.us/us";
const FCC_AREA = "https://geo.fcc.gov/api/census/area";
const HIFLD = "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query";

async function getJson(url, opts = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || 15000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// ZIP (5-digit) -> { lat, lon, place, state, zip }. Throws if not found.
export async function geocodeZip(zip) {
  const z = String(zip).trim();
  if (!/^\d{5}$/.test(z)) throw new Error("not a 5-digit ZIP");
  const d = await getJson(`${ZIPPOPOTAM}/${z}`);
  const p = (d.places && d.places[0]) || null;
  if (!p) throw new Error(`ZIP ${z} not found`);
  return { lat: Number(p.latitude), lon: Number(p.longitude), place: p["place name"], state: p["state abbreviation"], zip: z };
}

// Free-text input -> { lat, lon, label }. ZIP goes through Zippopotam (CORS-open); a bare "lat,lon"
// is accepted directly; anything else is left to the caller (address geocoding needs a keyed/proxied
// service and is a later enhancement — the UI nudges users to ZIP or "use my location").
export async function geocode(query) {
  const q = String(query || "").trim();
  const ll = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (ll) return { lat: Number(ll[1]), lon: Number(ll[2]), label: q };
  if (/^\d{5}$/.test(q)) { const g = await geocodeZip(q); return { lat: g.lat, lon: g.lon, label: `${g.place}, ${g.state} ${g.zip}` }; }
  throw new Error("Enter a 5-digit ZIP code, a 'lat,lon' pair, or use 'My location'.");
}

// lat,lon -> { fips, county, state } via the FCC Area API.
export async function latlonToCounty(lat, lon) {
  const d = await getJson(`${FCC_AREA}?lat=${lat}&lon=${lon}&censusYear=2020&format=json`);
  const a = (d.results && d.results[0]) || null;
  if (!a || !a.county_fips) throw new Error("no county for that point");
  return { fips: String(a.county_fips), county: a.county_name, state: a.state_code };
}

// lat,lon -> [{ name, type, holdingCo, state, customers, website }]  (often >1 — overlapping territories)
export async function latlonToUtilities(lat, lon) {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME,TYPE,HOLDING_CO,STATE,CUSTOMERS,WEBSITE", returnGeometry: "false", f: "json"
  });
  const d = await getJson(`${HIFLD}?${params}`);
  return (d.features || []).map((f) => {
    const a = f.attributes || {};
    return { name: a.NAME, type: a.TYPE, holdingCo: a.HOLDING_CO, state: a.STATE, customers: a.CUSTOMERS, website: a.WEBSITE };
  });
}

// Full pipeline for a resolved point: county + serving utilities together.
export async function resolvePoint(lat, lon) {
  const [county, utilities] = await Promise.all([
    latlonToCounty(lat, lon).catch(() => null),
    latlonToUtilities(lat, lon).catch(() => [])
  ]);
  return { lat, lon, county, utilities };
}
