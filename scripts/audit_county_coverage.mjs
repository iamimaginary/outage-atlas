// County-coverage audit. Answers "how many of the ~3,143 US counties can this atlas give a recovery
// time for?" by comparing the canonical county universe (us-atlas FIPS) against (a) the deployed ODIN
// baseline snapshot (counties currently reporting) and (b) the structural exclusions we know about
// (ODIN does not cover Alaska or Hawaii at all). Run:
//   node scripts/audit_county_coverage.mjs [baseline.json | URL]
// Default reads the deployed snapshot on tracker-data. This is a REPORT (informational), not a gate:
// ODIN is participation-based and only lists counties with active outages, so "currently covered" is a
// live lower bound, while AK/HI are a permanent structural gap (deep feeds are the only path there).
import { loadJson } from "./lib/load.mjs";

const ATLAS = "https://unpkg.com/us-atlas@3/counties-10m.json";
const DEPLOYED = "https://raw.githubusercontent.com/iamimaginary/outage-atlas/tracker-data/national/baseline.json";
const STATE_NAME = { "02": "Alaska", "15": "Hawaii" };

const baseSrc = process.argv[2] || DEPLOYED;

const topo = await loadJson(ATLAS);
const geoms = (topo.objects && topo.objects.counties && topo.objects.counties.geometries) || [];
// 50 states + DC: state FIPS 01..56 (territories 60/66/69/72/78 excluded)
const universe = geoms.map((g) => String(g.id)).filter((id) => /^\d{5}$/.test(id) && +id.slice(0, 2) <= 56);
const byState = {};
for (const f of universe) (byState[f.slice(0, 2)] = byState[f.slice(0, 2)] || []).push(f);

let base = {};
try { base = await loadJson(baseSrc); } catch (e) { console.error(`(could not load baseline ${baseSrc}: ${e.message})`); }
const counties = base.counties || base || {};
const covered = new Set(Object.keys(counties).filter((k) => /^\d{5}$/.test(k)));

const akhi = universe.filter((f) => STATE_NAME[f.slice(0, 2)]);
const coveredNow = universe.filter((f) => covered.has(f));
const conus = universe.filter((f) => !STATE_NAME[f.slice(0, 2)]);

console.log(`county universe (50 states + DC):     ${universe.length}`);
console.log(`  CONUS + non-AK/HI:                  ${conus.length}`);
console.log(`  Alaska (${byState["02"].length}) + Hawaii (${byState["15"].length}) = STRUCTURAL ODIN gap: ${akhi.length}  (deep feeds are the only path there)`);
console.log(`baseline source: ${baseSrc.startsWith("http") ? "deployed tracker-data" : baseSrc}`);
console.log(`counties reporting in baseline NOW:    ${coveredNow.length}  (ODIN lists only counties with active outages, so this is a live lower bound)`);
const akhiCovered = akhi.filter((f) => covered.has(f)).length;
console.log(`  of those, in AK/HI:                  ${akhiCovered}  (expected 0 from ODIN)`);

// per-state: how many counties currently reporting / total
const rows = Object.keys(byState).sort().map((s) => {
  const tot = byState[s].length, cov = byState[s].filter((f) => covered.has(f)).length;
  return { s, tot, cov };
});
const zero = rows.filter((r) => r.cov === 0);
console.log(`\nstates with 0 counties reporting right now: ${zero.length} (${zero.map((r) => r.s).join(",")})`);
console.log(`(state FIPS 02=AK 15=HI are the permanent gaps; others are simply calm right now)`);
