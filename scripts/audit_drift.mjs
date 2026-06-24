// Source-drift audit. Fetches a live ODIN sample and compares its record SHAPE (field keys) to what
// the adapter relies on. A vendor changing their schema is the #1 way an adapter silently breaks; this
// catches it early. FAILS if a REQUIRED field disappears (the adapter would mis-parse); WARNS on new or
// vanished non-required fields (a drift signal worth a look). Designed to run on a schedule (Phase 4)
// and, on failure, auto-capture the payload + file a `drift` issue.
//
//   node scripts/audit_drift.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { analyzeOdinShape } from "./lib/audits.mjs";

const ODIN_BASE = "https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county";
// Fields parseOdinRecords() depends on — losing any of these breaks the baseline:
const REQUIRED = ["communitydescriptor", "metersaffected", "utility_id", "name", "county", "state", "estimatedrestorationtime"];
// Full field set observed in the Phase -1 spike — anything outside this is NEW (potential drift):
const KNOWN = new Set(["cause", "causekind", "centroid", "communitydescriptor", "county", "customersrestored", "estimatedrestorationtime", "geo_point_2d", "geom", "incident", "incident_cause", "incident_location", "incident_location_kind", "metersaffected", "name", "reportedstarttime", "state", "statuskind", "utility_id", "utilitydisclaimer"]);

const r = await fetch(`${ODIN_BASE}/records?limit=5`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
if (!r.ok) { console.error(`ODIN unreachable: ${r.status}`); process.exit(1); }
const data = await r.json();
const recs = data.results || [];
if (!recs.length) { console.error("ODIN returned no records to shape-check"); process.exit(1); }

const { seen, missingRequired, newKeys, vanished } = analyzeOdinShape(recs, REQUIRED, KNOWN);

console.log(`drift audit: ${seen.length} fields seen across ${recs.length} sample records`);
if (newKeys.length) console.log("  · NEW fields (not in known set):", newKeys.join(", "));
if (vanished.length) console.log("  · known fields not present in sample:", vanished.join(", "));

if (missingRequired.length) {
  // capture the payload so an agent can reproduce offline (Phase-4 loop files a `drift`/`adapter-broken` issue)
  mkdirSync("adapters/fixtures/odin", { recursive: true });
  const ts = process.env.DRIFT_TS || "captured";
  writeFileSync(`adapters/fixtures/odin/drift-${ts}.json`, JSON.stringify(data, null, 2));
  console.error(`\nDRIFT FAILURE: ODIN dropped required field(s): ${missingRequired.join(", ")} — adapter will mis-parse. Payload captured.`);
  process.exit(1);
}
console.log("  ✓ all required fields present");
