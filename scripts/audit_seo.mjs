// SEO audit (Phase 4 gate). Guards the generated area pages against the classic programmatic-SEO
// footguns: duplicate/empty titles, canonical that doesn't match the URL, an accidental noindex, and
// pages missing from the sitemap (or sitemap entries with no page). No network. Exits non-zero.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE_BASE || "https://outageatlas.com").replace(/\/$/, "");
const errs = [];

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const pages = walk(join(ROOT, "outage")).filter((p) => p.endsWith(".html"));
if (!pages.length) { console.error("SEO audit: no generated pages under outage/ — run scripts/gen_area_pages.mjs"); process.exit(1); }

// file path -> canonical URL (index.html -> dir with trailing slash; foo.html -> /foo, no extension)
function canonicalOf(file) {
  let rel = relative(ROOT, file).replace(/\\/g, "/"); // e.g. outage/oh/cuyahoga.html
  rel = rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel.replace(/\.html$/, "");
  return `${SITE}/${rel}`;
}

const grab = (html, re) => { const m = html.match(re); return m ? m[1].trim() : null; };
const sitemap = existsSync(join(ROOT, "sitemap.xml")) ? readFileSync(join(ROOT, "sitemap.xml"), "utf8") : "";
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const locSet = new Set(locs);
if (locs.length !== locSet.size) errs.push("sitemap.xml has duplicate <loc> entries");
for (const req of [`${SITE}/`, `${SITE}/outage/`]) if (!locSet.has(req)) errs.push(`sitemap.xml missing required URL ${req}`);

const titles = new Map();
for (const p of pages) {
  const html = readFileSync(p, "utf8");
  const rel = relative(ROOT, p);
  const title = grab(html, /<title>([^<]+)<\/title>/);
  const canon = grab(html, /rel="canonical"\s+href="([^"]+)"/);
  const h1 = grab(html, /<h1>([\s\S]*?)<\/h1>/);
  const robots = grab(html, /name="robots"\s+content="([^"]+)"/) || "index,follow";
  const want = canonicalOf(p);

  if (!title) errs.push(`${rel}: missing <title>`);
  else if (titles.has(title)) errs.push(`${rel}: duplicate <title> (also ${titles.get(title)})`);
  else titles.set(title, rel);
  if (!h1) errs.push(`${rel}: missing <h1>`);
  if (/noindex/i.test(robots)) errs.push(`${rel}: robots is noindex — area pages must be indexable`);
  if (canon !== want) errs.push(`${rel}: canonical "${canon}" != expected "${want}"`);
  if (canon && !locSet.has(canon)) errs.push(`${rel}: canonical not in sitemap.xml (${canon})`);
}

// every area/state canonical in sitemap should correspond to a generated file (no orphan sitemap URLs)
const canonSet = new Set(pages.map(canonicalOf));
for (const loc of locs) if (loc.includes("/outage/") && !canonSet.has(loc)) errs.push(`sitemap URL has no generated page: ${loc}`);

// robots.txt must point at the sitemap
const robotsTxt = existsSync(join(ROOT, "robots.txt")) ? readFileSync(join(ROOT, "robots.txt"), "utf8") : "";
if (!/Sitemap:\s*\S+sitemap\.xml/i.test(robotsTxt)) errs.push("robots.txt missing Sitemap: reference");

if (errs.length) { console.error("SEO AUDIT FAILED:"); for (const e of errs) console.error("  ✗ " + e); process.exit(1); }
console.log(`SEO audit passed: ${pages.length} pages, all with unique titles + matching canonicals, all in sitemap (${locs.length} URLs).`);
