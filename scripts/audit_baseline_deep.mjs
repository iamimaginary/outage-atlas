// Baseline <-> deep cross-source agreement. The deep feed (e.g. FirstEnergy's own Kübra total) and the
// ODIN baseline are INDEPENDENT pipelines, so they won't match exactly — but a gross divergence means
// one side is mis-parsed/stale/mis-attributed. For each deep utility we sum the ODIN baseline's out
// across counties whose reporting utility name matches the utility's `match` patterns, and compare to
// the deep feed's own published total. Generous tolerance (different methodologies/timing). Informational
// by default; --strict fails on a gross breach (for the scheduled audit).
//
//   node scripts/audit_baseline_deep.mjs [--baseline <path-or-url>] [--utils <dir-or-url>] [--strict]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJson } from "./lib/load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const baselineSrc = opt("--baseline", join(ROOT, "data", "national", "baseline.json"));
const utilsBase = opt("--utils", join(ROOT, "data", "utilities"));
const strict = args.includes("--strict");
const isUrl = /^https?:\/\//.test(utilsBase);

const TOL_PCT = 60;   // generous: independent sources
const FLOOR = 300;    // both sides small -> noise; skip

const baseline = await loadJson(baselineSrc);
const matchesOut = (patterns) => {
  let sum = 0;
  const P = patterns.map((p) => p.toUpperCase());
  for (const fips in baseline.counties) for (const u of baseline.counties[fips].utilities || [])
    if (P.some((p) => (u.name || "").toUpperCase().includes(p))) sum += u.out || 0;
  return sum;
};

let ids;
if (isUrl) { ids = readdirSync(join(ROOT, "utilities")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")); }
else { ids = existsSync(utilsBase) ? readdirSync(utilsBase).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : []; }

const pct = (a, b) => (Math.abs(a - b) / Math.max(b, 1)) * 100;
const fails = [], notes = [];

for (const id of ids) {
  const ucfg = JSON.parse(readFileSync(join(ROOT, "utilities", `${id}.json`), "utf8"));
  const snap = await loadJson(isUrl ? `${utilsBase.replace(/\/$/, "")}/${id}.json` : join(utilsBase, `${id}.json`));
  const deepOut = snap.official.out;
  const baseOut = matchesOut(ucfg.match || [ucfg.name]);
  if (Math.max(deepOut, baseOut) < FLOOR) { notes.push(`${id}: deep ${deepOut} vs ODIN ${baseOut} — below floor, skipped`); continue; }
  const d = pct(deepOut, baseOut);
  (d > TOL_PCT ? fails : notes).push(`${id}: deep ${deepOut} vs ODIN-baseline ${baseOut} -> ${d.toFixed(0)}% (tol ${TOL_PCT}%)`);
}

console.log("baseline<->deep agreement:");
for (const n of notes) console.log("  · " + n);
for (const f of fails) console.error("  ✗ " + f);
if (strict && fails.length) { console.error(`\nCROSS-SOURCE DIVERGENCE (${fails.length}) — investigate a mis-parse / mis-attribution / stale feed.`); process.exit(1); }
console.log(fails.length ? "  (divergences noted; not failing — independent sources. Use --strict to enforce.)" : "  ✓ within tolerance");
