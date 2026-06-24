// ToS guard (CI gate + scheduled). poweroutage.us is commercially licensed and prohibits
// unlicensed/scraped use; it is OFF by default and may ONLY be enabled by the operator with their own
// license key. This enforces that line in code: if any executable file references poweroutage in a
// string/URL/import (i.e., a real integration, not a doc/comment) and POWEROUTAGE_LICENSE_KEY is not
// set, this FAILS — STOP / needs-human. Prevents an agent from quietly adding it.
//
//   node scripts/audit_tos.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { tosViolation } from "./lib/audits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["scripts", "scripts/lib", "adapters", "web", "workers"];
const CODE_EXT = /\.(mjs|js|html)$/;
// the guard's own machinery legitimately references poweroutage (to enforce/test the rule) — exclude it
const EXCLUDE = new Set(["audit_tos.mjs", "audits.mjs", "test_audits.mjs"]);

// collect "real integration" signals only: filenames + quoted string literals (skips bare mentions in
// comments/docs so the ToS STOP rule itself can be documented without tripping the guard).
const signals = [];
const scanFile = (p) => {
  const name = basename(p);
  if (/poweroutage/i.test(name)) signals.push(`file:${name}`);
  const txt = readFileSync(p, "utf8");
  for (const m of txt.matchAll(/["'`][^"'`]*poweroutage[^"'`]*["'`]/gi)) signals.push(`literal:${m[0].slice(0, 60)}`);
  for (const m of txt.matchAll(/import[^;\n]*poweroutage[^;\n]*/gi)) signals.push(`import:${m[0].slice(0, 60)}`);
};
const walk = (dir) => {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) continue;
    if (EXCLUDE.has(e)) continue;
    if (CODE_EXT.test(e)) scanFile(p);
  }
};
for (const d of SCAN_DIRS) walk(join(ROOT, d));
try { scanFile(join(ROOT, "index.html")); } catch {}

const hasKey = !!process.env.POWEROUTAGE_LICENSE_KEY;
const v = tosViolation(signals.join("\n"), hasKey);
if (v.stop) {
  console.error("ToS GUARD FAILED — STOP (label: needs-human):");
  console.error("  " + v.reason);
  for (const s of signals) console.error("    · " + s);
  process.exit(1);
}
console.log(hasKey
  ? "ToS guard: POWEROUTAGE_LICENSE_KEY present — operator-licensed use permitted."
  : "ToS guard: no poweroutage integration in code (as required).");
