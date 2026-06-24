// Reconciliation gate — the safety net against a "wrong but passing" adapter fix. An adapter can pass
// its golden test yet mis-parse live data; this catches it by checking that our SUMMED areas total
// agrees with the source's OWN published headline (official.out), per utility, within that utility's
// tolerance. (This is exactly what flagged the Kübra multi-state bug in the spike.) Trust this over the
// golden test when they disagree. Reads local snapshots by default, or a tracker-data base URL.
//
//   node scripts/check_reconciliation.mjs [utilityId|all] [--base <dir-or-url>]
// Exits non-zero on any breach.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJson } from "./lib/load.mjs";
import { reconcile } from "./lib/audits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) || "all";
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : null) || join(ROOT, "data", "utilities");
const isUrl = /^https?:\/\//.test(base);
const FLOOR = 200; // ignore tiny totals where Kübra masking / rounding dominates

const ids = which === "all"
  ? (isUrl ? null : readdirSync(base).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")))
  : [which];
if (!ids) throw new Error("`all` needs a local --base dir; give a specific utilityId for a URL base");

const fails = [], notes = [];

for (const id of ids) {
  const cfgPath = join(ROOT, "utilities", `${id}.json`);
  if (!existsSync(cfgPath)) { notes.push(`${id}: snapshot has no matching utilities/${id}.json — skipped`); continue; }
  const ucfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const tol = (ucfg.reconciliation && ucfg.reconciliation.tolerancePct) || 15;
  const snap = await loadJson(isUrl ? `${base.replace(/\/$/, "")}/${id}.json` : join(base, `${id}.json`));
  const summed = (snap.areas || []).reduce((a, c) => a + (c.out || 0), 0);
  const official = snap.official ? snap.official.out : null;
  const r = reconcile(summed, official, tol, FLOOR);
  if (r.reason) { fails.push(`${id}: ${r.reason}`); continue; }
  if (r.skipped) { notes.push(`${id}: below floor (summed ${summed} / official ${official}) — skipped`); continue; }
  (r.ok ? notes : fails).push(`${id}: our sum ${summed} vs published ${official} -> ${r.pct.toFixed(1)}% (tol ${tol}%)`);
}

console.log("reconciliation:");
for (const n of notes) console.log("  · " + n);
for (const f of fails) console.error("  ✗ " + f);
if (fails.length) { console.error(`\nRECONCILIATION FAILED (${fails.length}) — likely a mis-parsing adapter or a bad source.`); process.exit(1); }
console.log("  ✓ within tolerance");
