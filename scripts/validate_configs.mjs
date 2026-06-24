// Config validator (CI gate). Every utilities/<id>.json must be well-formed and reference a real
// adapter, and every adapters/fixtures/<vendor>/ dir must map to a registered adapter. This is the
// deterministic guard that lets a maintenance agent add a utility/adapter without breaking the
// collector. Extracts (and generalizes) the inline node check NEO ran in checks.yml. Exits non-zero
// on any problem.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ADAPTERS, adapterIds } from "../adapters/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UTIL = join(ROOT, "utilities");
const FIX = join(ROOT, "adapters", "fixtures");
const errs = [];
let n = 0;

// 1) utilities/<id>.json well-formed + adapter registered
if (existsSync(UTIL)) {
  for (const f of readdirSync(UTIL).filter((x) => x.endsWith(".json"))) {
    n++;
    const label = `utilities/${f}`;
    let c;
    try { c = JSON.parse(readFileSync(join(UTIL, f), "utf8")); }
    catch (e) { errs.push(`${label}: invalid JSON — ${e.message}`); continue; }
    if (!c.id || typeof c.id !== "string") errs.push(`${label}: missing string "id"`);
    if (f !== `${c.id}.json`) errs.push(`${label}: filename must match id (expected ${c.id}.json)`);
    if (!c.adapter || !ADAPTERS[c.adapter]) errs.push(`${label}: adapter "${c.adapter}" not in registry (${adapterIds().join(", ")})`);
    if (!c.config || typeof c.config !== "object") errs.push(`${label}: missing "config" object`);
    if (c.fips != null && !(Array.isArray(c.fips) && c.fips.every((x) => /^\d{5}$/.test(String(x))))) errs.push(`${label}: "fips" must be an array of 5-digit county codes`);
    if (c.reconciliation && typeof c.reconciliation.tolerancePct !== "number") errs.push(`${label}: reconciliation.tolerancePct must be a number`);
    if (!errs.some((e) => e.startsWith(label))) console.log(`ok ${label}`);
  }
}
if (!n) console.log("no utilities/*.json yet (none required at this phase)");

// 2) every fixture vendor dir maps to a registered adapter
if (existsSync(FIX)) {
  for (const d of readdirSync(FIX)) {
    if (!statSync(join(FIX, d)).isDirectory()) continue;
    if (!ADAPTERS[d]) errs.push(`adapters/fixtures/${d}/: no adapter "${d}" registered`);
  }
}

if (errs.length) { console.error("\nCONFIG VALIDATION FAILED:"); for (const e of errs) console.error("  ✗ " + e); process.exit(1); }
console.log(`\nconfig validation passed (${n} utility config${n === 1 ? "" : "s"})`);
