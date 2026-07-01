// Per-area Open Graph cards (handoff Phase 5) — a 1200x630 PNG per county so shared/auto-posted links
// unfurl richly with the AREA NAME baked in. Evergreen (identity-based, generated with the area pages),
// so no serverless renderer + no per-collect churn; the live number lives on the page, the card carries
// the place. Pure, dependency-free (scripts/lib/png.mjs + font5x7). Written to og/<st>/<slug>.png.
//
//   node scripts/gen_og_cards.mjs        # same county source as gen_area_pages.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Canvas } from "./lib/png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = 2; // supersample
const W = 1200 * S, H = 630 * S;
const BG = [13, 17, 23], DISC = [27, 34, 48], ACC = [88, 166, 255], FG = [230, 237, 243], MUT = [157, 167, 179], BAR = [63, 185, 80];
const BOLT = [[0.55, 0.05], [0.25, 0.55], [0.45, 0.55], [0.35, 0.95], [0.75, 0.40], [0.53, 0.40], [0.55, 0.05]];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function loadCounties() {
  for (const f of [process.env.AREA_SOURCE, join(ROOT, "data/national/baseline.json"), join(ROOT, "scripts/data/seed-counties.json")].filter(Boolean)) {
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, "utf8"));
    const rows = Array.isArray(j) ? j : Object.values(j.counties || j);
    const seen = new Set(), out = [];
    for (const r of rows) { const fips = String(r.fips || "").padStart(5, "0"); if (/^\d{5}$/.test(fips) && r.county && r.state && !seen.has(fips)) { seen.add(fips); out.push({ fips, county: r.county, state: r.state }); } }
    if (out.length) return out;
  }
  throw new Error("no county source found");
}

const fit = (cv, str, availW, max) => { let s = max; while (s > 1 && cv.textWidth(str, s) > availW) s--; return s; };

function card({ county, state }) {
  const cv = new Canvas(W, H);
  cv.fillRect(0, 0, W, H, BG);
  // depth disc + bolt on the left
  const cx = 360 * S, cy = 315 * S, disc = 240 * S;
  cv.fillCircle(cx, cy, disc, DISC);
  const size = 300 * S, bx = cx - size / 2, by = cy - size / 2;
  cv.fillPolygon(BOLT.map(([u, v]) => [bx + u * size, by + v * size]), ACC);
  // text block on the right
  const tx = 620 * S, availW = W - tx - 60 * S;
  const title = `${county}, ${state}`.toUpperCase();
  const ts = fit(cv, title, availW, 22 * S);
  cv.text(tx, cy - 120 * S, title, ts, FG);
  cv.text(tx, cy + 10 * S, "LIVE POWER OUTAGE STATUS", fit(cv, "LIVE POWER OUTAGE STATUS", availW, 11 * S), ACC);
  cv.text(tx, cy + 70 * S, "CUSTOMERS OUT - RECOVERY ETA - ALERTS", fit(cv, "CUSTOMERS OUT - RECOVERY ETA - ALERTS", availW, 7 * S), MUT);
  cv.text(tx, cy + 150 * S, "OUTAGEATLAS.COM", fit(cv, "OUTAGEATLAS.COM", availW, 9 * S), MUT);
  cv.fillRect(0, H - 12 * S, W, 12 * S, BAR);
  return cv.toPNG(S);
}

(function main() {
  const counties = loadCounties();
  let n = 0;
  for (const c of counties) {
    const dir = join(ROOT, "og", c.state.toLowerCase());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug(c.county)}.png`), card(c));
    n++;
  }
  console.log(`generated ${n} per-area OG cards under og/`);
})();
