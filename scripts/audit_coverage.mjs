// Coverage-gap audit. Reports per-state ODIN coverage from the baseline (counties reporting, customers
// out, distinct utilities) — the national-expansion roadmap signal. By default it REPORTS (exit 0):
// a quiet day legitimately has few states with active outages, so absence != failure. In --strict mode
// it fails on a REGRESSION: a state listed in audits/coverage-expected.json that is now absent (a sign
// the feed or the adapter dropped a previously-covered region).
//
//   node scripts/audit_coverage.mjs [path-or-url]                 # report
//   node scripts/audit_coverage.mjs [path-or-url] --strict        # fail on regression vs expected
//   node scripts/audit_coverage.mjs [path-or-url] --write-expected # snapshot current states as the baseline
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { loadJson } from "./lib/load.mjs";
import { coverageRegression } from "./lib/audits.mjs";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "data/national/baseline.json";
const strict = args.includes("--strict");
const writeExpected = args.includes("--write-expected");
const EXPECTED = "audits/coverage-expected.json";

const b = await loadJson(src);
const byState = {};
for (const fips of Object.keys(b.counties || {})) {
  const c = b.counties[fips];
  const s = (byState[c.state] = byState[c.state] || { counties: 0, out: 0, utils: new Set() });
  s.counties++; s.out += c.out || 0;
  for (const u of c.utilities || []) s.utils.add(u.id);
}
const states = Object.keys(byState).sort((a, z) => byState[z].out - byState[a].out);

console.log(`coverage [${src}]: ${states.length} states with active outages`);
for (const s of states) console.log(`  ${s.padEnd(22)} counties=${String(byState[s].counties).padStart(3)} out=${String(byState[s].out).padStart(8)} utilities=${byState[s].utils.size}`);

if (writeExpected) {
  mkdirSync("audits", { recursive: true });
  writeFileSync(EXPECTED, JSON.stringify({ note: "States ODIN has been observed reporting. --strict fails if one goes missing (regression).", states: states.sort() }, null, 2));
  console.log(`\nwrote ${EXPECTED} (${states.length} states)`);
}

if (strict) {
  if (!existsSync(EXPECTED)) { console.error(`\n--strict but ${EXPECTED} missing; run --write-expected first`); process.exit(1); }
  const expected = JSON.parse(readFileSync(EXPECTED, "utf8")).states || [];
  const { missing } = coverageRegression(states, expected);
  if (missing.length) { console.error(`\nCOVERAGE REGRESSION: previously-covered states now absent: ${missing.join(", ")}`); process.exit(1); }
  console.log(`\n  ✓ no coverage regression (${expected.length} expected states all present)`);
}
