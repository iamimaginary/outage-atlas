// Baseline integrity audit (Gate 1). Validates data/national/baseline.json: structural shape,
// internal consistency (national rollup == sum of counties; county.out == sum of its utilities),
// clean FIPS, non-empty, and freshness. This is the baseline's schema gate (ODIN is an out-count
// product, so it is validated HERE, not by the per-utility validateCanonical). Exits non-zero on a
// structural failure.
//
//   node scripts/check_baseline.mjs [path-or-url] [--max-age-min N]
import { loadJson } from "./lib/load.mjs";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "data/national/baseline.json";
const maxAgeMin = Number((args.find((a) => a.startsWith("--max-age-min")) || "").split("=")[1] || (args[args.indexOf("--max-age-min") + 1])) || null;

const b = await loadJson(src);
const errs = [], warns = [];
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

if (b.schema !== 1) errs.push(`schema: expected 1, got ${b.schema}`);
if (b.source !== "odin") warns.push(`source: expected "odin", got ${b.source}`);
if (typeof b.collectedAt !== "number") errs.push("collectedAt: missing/!number");
if (!b.national || typeof b.national !== "object") errs.push("national: missing");
if (!b.counties || typeof b.counties !== "object" || Array.isArray(b.counties)) errs.push("counties: must be an object map");

if (!errs.length) {
  const fipsList = Object.keys(b.counties);
  if (!fipsList.length) errs.push("counties: empty (refuse a blank baseline)");
  const cOut = sum(fipsList, (k) => b.counties[k].out || 0);
  const cInc = sum(fipsList, (k) => b.counties[k].incidents || 0);
  if (b.national.out !== cOut) errs.push(`national.out ${b.national.out} != sum of counties ${cOut}`);
  if (b.national.counties !== fipsList.length) errs.push(`national.counties ${b.national.counties} != ${fipsList.length}`);
  if (b.national.incidents !== cInc) errs.push(`national.incidents ${b.national.incidents} != sum ${cInc}`);

  for (const fips of fipsList) {
    const c = b.counties[fips];
    if (!/^\d{5}$/.test(fips)) errs.push(`county ${fips}: key not a 5-digit FIPS`);
    if (!(typeof c.out === "number" && c.out >= 0)) errs.push(`county ${fips}: out must be >= 0`);
    if (!Array.isArray(c.utilities)) { errs.push(`county ${fips}: utilities must be an array`); continue; }
    const uOut = sum(c.utilities, (u) => u.out || 0);
    if (uOut !== c.out) errs.push(`county ${fips}: out ${c.out} != sum of utilities ${uOut}`);
  }
  if (b.national.skipped > b.national.incidents) warns.push(`national.skipped ${b.national.skipped} > aggregated ${b.national.incidents} — possible ODIN shape drift`);

  const ageMin = (Date.now() - b.collectedAt) / 60000;
  const ageStr = `${ageMin.toFixed(0)} min old`;
  if (maxAgeMin && ageMin > maxAgeMin) errs.push(`stale: ${ageStr} > max ${maxAgeMin} min`);
  else if (ageMin > 60) warns.push(`baseline is ${ageStr}`);

  console.log(`baseline [${src}] (${ageStr}): ${fipsList.length} counties, ${b.national.out} out, ${b.national.states} states, ${b.national.utilities} utilities, ${(b.alerts || []).length} alerts`);
}

for (const w of warns) console.log("  · " + w);
for (const e of errs) console.error("  ✗ " + e);
if (errs.length) { console.error(`\nBASELINE CHECK FAILED (${errs.length}).`); process.exit(1); }
console.log("  ✓ baseline valid");
