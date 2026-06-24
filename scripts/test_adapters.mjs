// Golden tests for source adapters. For each adapters/fixtures/<adapter>/*.json it runs the pure
// parser on `raw`, checks the result against the canonical schema (when the adapter is canonical),
// and deep-compares to `expected` (when present). This is the loop an agent uses to fix a broken
// adapter: reproduce against the captured fixture, edit the parser, run `node scripts/test_adapters.mjs`
// until green. Exits non-zero on any failure. Adapters resolve through adapters/registry.mjs.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateCanonical } from "../adapters/schema.mjs";
import { ADAPTERS } from "../adapters/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "adapters", "fixtures");

function deepEqual(a, b, path = "") {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9 ? null : `${path}: ${a} !== ${b}`;
  if (typeof a !== typeof b) return `${path}: ${typeof a} !== ${typeof b}`;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object mismatch`;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return `${path}: ${ka.length} keys !== ${kb.length} (${ka} vs ${kb})`;
    for (const k of ka) { const d = deepEqual(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
}

let total = 0, failed = 0;
if (!existsSync(FIX)) { console.log("no adapters/fixtures — nothing to test"); process.exit(0); }

for (const adapter of readdirSync(FIX)) {
  const cfg = ADAPTERS[adapter];
  const dir = join(FIX, adapter);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    total++;
    const label = `${adapter}/${f}`;
    if (!cfg) { failed++; console.error(`✗ ${label}: no adapter registered for "${adapter}" (add it to adapters/registry.mjs)`); continue; }
    try {
      const { raw, expected, fn, opts } = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const parser = cfg.mod[fn || cfg.defaultFn];
      if (typeof parser !== "function") { failed++; console.error(`✗ ${label}: no exported fn "${fn || cfg.defaultFn}"`); continue; }
      // opts (when present) mirrors a utility's config.config — needed by config-driven adapters (arcgis).
      const got = parser(raw, opts);
      if (cfg.canonical) { const v = validateCanonical(got); if (!v.ok) { failed++; console.error(`✗ ${label}: schema invalid →\n   ${v.errors.join("\n   ")}`); continue; } }
      if (expected) { const d = deepEqual(got, expected); if (d) { failed++; console.error(`✗ ${label}: output mismatch at ${d}`); continue; } }
      console.log(`✓ ${label}`);
    } catch (e) {
      failed++; console.error(`✗ ${label}: threw → ${e.message}`);
    }
  }
}
console.log(`\n${total - failed}/${total} adapter golden tests passed`);
process.exit(failed ? 1 : 0);
