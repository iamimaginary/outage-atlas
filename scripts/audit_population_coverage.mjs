// Population/customer-coverage audit. Answers "what share of US electricity customers (a proxy for the
// ~340M population) does the atlas cover?" by summing HIFLD's per-territory CUSTOMERS field and bucketing
// each territory into: DEEP (matches a wired utility's match patterns), or BASELINE-eligible (CONUS, via
// ODIN), or NO-ODIN (Alaska/Hawaii — deep is the only path). HIFLD CUSTOMERS sums to ~all US metered
// accounts, so this turns "coverage" into a real percentage. Run:
//   node scripts/audit_population_coverage.mjs
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const U = join(ROOT, "utilities");
const HIFLD = "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query";
const NO_ODIN = new Set(["AK", "HI"]);

const deep = readdirSync(U).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(U, f), "utf8")));
const enabledDeep = deep.filter((d) => !d.disabled);
const deepMatch = (name, hc) => {
  const N = (name || "").toUpperCase(), H = (hc || "").toUpperCase();
  for (const d of enabledDeep) if ((d.match || []).some((p) => N.includes(p) || H.includes(p))) return d.id;
  return null;
};

// page through all HIFLD territories
const feats = [];
for (let off = 0; off < 8000; off += 2000) {
  const url = `${HIFLD}?where=1%3D1&outFields=NAME,HOLDING_CO,STATE,CUSTOMERS&returnGeometry=false&f=json&resultOffset=${off}&resultRecordCount=2000`;
  const r = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) })).json();
  const fs = r.features || [];
  feats.push(...fs);
  if (fs.length < 2000) break;
}
const cust = (a) => { const c = +a.CUSTOMERS; return isFinite(c) && c > 0 ? c : 0; };
let total = 0, deepC = 0, akhiC = 0, akhiDeepC = 0;
const perDeep = {};
for (const f of feats) {
  const a = f.attributes || {};
  const c = cust(a);
  total += c;
  const st = (a.STATE || "").toUpperCase();
  const id = deepMatch(a.NAME, a.HOLDING_CO);
  if (id) { deepC += c; perDeep[id] = (perDeep[id] || 0) + c; }
  if (NO_ODIN.has(st)) { akhiC += c; if (id) akhiDeepC += c; }
}
const conusBaseline = total - akhiC; // CONUS customers reachable by ODIN baseline (participation permitting)
const pct = (x) => (100 * x / total).toFixed(1) + "%";
console.log(`HIFLD territories: ${feats.length}  | total customers (metered accounts): ${total.toLocaleString()}`);
console.log("");
console.log(`DEEP precision coverage:     ${deepC.toLocaleString()}  (${pct(deepC)} of US customers)  across ${Object.keys(perDeep).length} wired utilities`);
console.log(`BASELINE-eligible (CONUS):   ${conusBaseline.toLocaleString()}  (${pct(conusBaseline)})  — ODIN national, participation-permitting`);
console.log(`AK + HI (no ODIN baseline):  ${akhiC.toLocaleString()}  (${pct(akhiC)})  — deep-only; ${akhiDeepC.toLocaleString()} of that is deep-covered (Chugach/GVEA/KIUC)`);
console.log("");
console.log("top deep utilities by customers:");
for (const [id, c] of Object.entries(perDeep).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${id.padEnd(18)} ${c.toLocaleString()}`);
