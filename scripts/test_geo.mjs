// Geo-resolution golden tests — deterministic, NO network. Stubs globalThis.fetch with captured
// fixtures (web/fixtures/geo/) and exercises web/geo.mjs end-to-end, asserting the known result for a
// Cleveland ZIP: county FIPS 39035, and the OVERLAPPING utility pair (a municipal + the FirstEnergy
// IOU). Locks the resolution contract so a refactor can't silently break "find my location". Exits
// non-zero on any assertion failure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fix = (f) => JSON.parse(readFileSync(join(ROOT, "web", "fixtures", "geo", f), "utf8"));
const ZIP = fix("zippopotam-44113.json"), FCC = fix("fcc-cleveland.json"), HIFLD = fix("hifld-cleveland.json");

// fixture-backed fetch stub keyed by URL substring
globalThis.fetch = async (url) => {
  const u = String(url);
  let body;
  if (u.includes("api.zippopotam.us/us/44113")) body = ZIP;
  else if (u.includes("geo.fcc.gov/api/census/area")) body = FCC;
  else if (u.includes("Electric_Retail_Service_Territories_HIFLD")) body = HIFLD;
  else throw new Error(`unexpected fetch in test: ${u}`);
  return { ok: true, status: 200, json: async () => body };
};

const { geocode, geocodeZip, resolvePoint } = await import("../web/geo.mjs");

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log("✓ " + msg); else { failed++; console.error("✗ " + msg); } };
const threw = async (fn, msg) => { try { await fn(); failed++; console.error("✗ " + msg + " (did not throw)"); } catch { console.log("✓ " + msg); } };

// 1) ZIP geocode
const g = await geocode("44113");
ok(Math.abs(g.lat - 41.4816) < 0.01 && Math.abs(g.lon + 81.7018) < 0.01, `geocode ZIP 44113 -> lat,lon (${g.lat},${g.lon})`);
ok(/Cleveland, OH 44113/.test(g.label), `geocode label "${g.label}"`);

// 2) bare lat,lon passes through without a fetch
const ll = await geocode("41.4816,-81.7018");
ok(ll.lat === 41.4816 && ll.lon === -81.7018, "geocode accepts a 'lat,lon' pair");

// 3) county + utilities resolution (the overlap case)
const r = await resolvePoint(g.lat, g.lon);
ok(r.county && r.county.fips === "39035", `county FIPS 39035 (got ${r.county && r.county.fips})`);
ok(r.county && r.county.state === "OH", `county state OH (got ${r.county && r.county.state})`);
ok(r.utilities.length === 2, `2 overlapping utilities (got ${r.utilities.length})`);
ok(r.utilities.some((u) => /CLEVELAND ELECTRIC ILLUM CO/i.test(u.name)), "serving utilities include the FirstEnergy IOU");
ok(r.utilities.some((u) => /MUNICIPAL/i.test(u.type || "")), "serving utilities include the municipal (overlap)");

// 4) bad inputs throw
await threw(() => geocode("not a place"), "geocode rejects free-text that isn't ZIP/latlon");
await threw(() => geocodeZip("123"), "geocodeZip rejects a non-5-digit ZIP");

console.log(`\n${failed ? failed + " FAILED" : "all geo tests passed"}`);
process.exit(failed ? 1 : 0);
