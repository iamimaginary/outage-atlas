// Feed-health audit (scheduled). Pings every upstream the platform depends on and reports reachability.
// FAILS if a CRITICAL feed (ODIN — the baseline) is down; WARNS on the rest (the page degrades
// gracefully: deep view / utility lookup / geocoding each fail soft). Quick HEAD/GET with a short
// timeout. Pairs with audit_csp.mjs (which checks the page is *allowed* to reach them).
//
//   node scripts/audit_feeds.mjs
const FEEDS = [
  { name: "ODIN (baseline)", critical: true, url: "https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records?limit=1" },
  { name: "NWS alerts", critical: false, url: "https://api.weather.gov/alerts/active?area=OH" },
  { name: "HIFLD territories", critical: false, url: "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json" },
  { name: "FCC Area API", critical: false, url: "https://geo.fcc.gov/api/census/area?lat=41.5&lon=-81.7&format=json" },
  { name: "Zippopotam", critical: false, url: "https://api.zippopotam.us/us/44113" }
];

const results = [];
for (const f of FEEDS) {
  let ok = false, detail = "";
  try {
    const r = await fetch(f.url, { headers: { "User-Agent": "outage-atlas-audit/0.1" }, signal: AbortSignal.timeout(20000) });
    ok = r.ok; detail = `HTTP ${r.status}`;
  } catch (e) { detail = e.message.slice(0, 60); }
  results.push({ ...f, ok, detail });
}

console.log("feed health:");
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(20)} ${r.detail}${r.critical ? " [critical]" : ""}`);

const downCritical = results.filter((r) => r.critical && !r.ok);
const downOther = results.filter((r) => !r.critical && !r.ok);
if (downOther.length) console.log(`\n  · ${downOther.length} non-critical feed(s) down — page degrades gracefully there.`);
if (downCritical.length) { console.error(`\nFEED HEALTH FAILED: critical feed(s) down: ${downCritical.map((r) => r.name).join(", ")}`); process.exit(1); }
console.log("\n  ✓ critical feeds reachable");
