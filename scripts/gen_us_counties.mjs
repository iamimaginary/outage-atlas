// Build the national county list for full-coverage SEO pages. Fetches the Census Bureau's authoritative
// county code file (pipe-delimited, plain text — no zip) and writes scripts/data/us-counties.json as
// [{fips,county,state}] for gen_area_pages.mjs / gen_og_cards.mjs to consume via AREA_SOURCE.
//
//   node scripts/gen_us_counties.mjs
//
// Names are normalized to a bare form (drop "County/Parish/Borough/…") but INDEPENDENT CITIES keep
// their " city" suffix — that's what distinguishes e.g. "Fairfax" (county) from "Fairfax city" (VA),
// avoiding slug/title collisions.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt";
// 50 states + DC + PR (matches STATE_NAMES in gen_area_pages.mjs); skip other territories.
const ALLOWED = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "));
const stripSuffix = (s) => s.replace(/\s+(City and Borough|Census Area|Municipality|Municipio|County|Parish|Borough)$/i, "").trim();

(async () => {
  const r = await fetch(SRC, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`census fetch ${r.status}`);
  const lines = (await r.text()).trim().split(/\r?\n/).slice(1); // drop header
  const seen = new Set(), out = [];
  for (const line of lines) {
    const [state, statefp, countyfp, , name] = line.split("|");
    if (!ALLOWED.has(state)) continue;
    const fips = `${statefp}${countyfp}`;
    if (!/^\d{5}$/.test(fips) || seen.has(fips)) continue;
    seen.add(fips);
    out.push({ fips, county: stripSuffix(name), state });
  }
  out.sort((a, b) => a.fips.localeCompare(b.fips));
  mkdirSync(join(ROOT, "scripts/data"), { recursive: true });
  writeFileSync(join(ROOT, "scripts/data/us-counties.json"), JSON.stringify(out));
  console.log(`wrote scripts/data/us-counties.json — ${out.length} counties across ${new Set(out.map((c) => c.state)).size} states`);
})().catch((e) => { console.error("gen_us_counties FAILED:", e.message); process.exit(1); });
