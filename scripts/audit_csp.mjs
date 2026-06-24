// CSP / page-structure audit. A real, recurring failure mode (documented in NEO): the page fetches an
// origin the Content-Security-Policy forbids, so it silently breaks in the browser. This checks that
// every host the page's JS actually loads (quoted https:// literals in geo.mjs / odin.mjs / the inline
// module) is allowed by the right CSP directive, that key API endpoints are in connect-src, that every
// getElementById target exists, and that pinned Leaflet assets carry SRI. No network. Exits non-zero.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

// Only scan executable JS for runtime fetch/tile hosts: the imported modules + the inline module script
// (NOT the footer <a href> links or comments — those aren't network requests the CSP governs).
const inlineModule = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || "";
const jsSources = ["web/geo.mjs", "adapters/odin.mjs"].filter((p) => existsSync(join(ROOT, p)))
  .map((p) => readFileSync(join(ROOT, p), "utf8")).join("\n") + "\n" + inlineModule;

const errs = [];

// parse CSP, stripping the scheme from each source so "https://unpkg.com" -> "unpkg.com"
const csp = (html.match(/Content-Security-Policy"\s+content="([\s\S]*?)"/) || [])[1];
if (!csp) errs.push("no Content-Security-Policy meta found");
const directives = {};
for (const part of (csp || "").split(";")) {
  const toks = part.trim().split(/\s+/); const name = toks.shift();
  if (name) directives[name] = toks.map((t) => t.replace(/^https?:\/\//, "")).filter((t) => t.includes("."));
}
const covers = (host, dir) => {
  const list = directives[dir] || [];
  const h2 = host.replace(/^\{[^}]+\}\./, ""); // strip templated subdomain e.g. {s}.
  return list.some((c) => c === host || c === h2 || (c.startsWith("*.") && (host.endsWith(c.slice(1)) || h2 === c.slice(2))));
};

// quoted https:// literals that the JS actually loads (skips bare URLs in comments)
const usedHosts = [...new Set([...jsSources.matchAll(/["'`]https:\/\/([a-z0-9.*{}-]+)/gi)].map((m) => m[1]))];
for (const h of usedHosts) {
  const dir = /basemaps\.cartocdn\.com/.test(h) ? "img-src" : "connect-src"; // tiles are images; everything else is fetch
  if (!covers(h, dir)) errs.push(`host "${h}" loaded by the page but not in ${dir}`);
}

// key API endpoints must be in connect-src
for (const h of ["api.zippopotam.us", "geo.fcc.gov", "services3.arcgis.com", "ornl.opendatasoft.com", "raw.githubusercontent.com"])
  if (!covers(h, "connect-src")) errs.push(`connect-src missing required endpoint "${h}"`);

// unpkg (Leaflet) must be allowed for script + style, and carry SRI
for (const d of ["script-src", "style-src"]) if (!covers("unpkg.com", d)) errs.push(`${d} missing unpkg.com (Leaflet)`);
for (const m of html.matchAll(/<(?:script|link)[^>]*unpkg\.com[^>]*>/g)) if (!/integrity="sha\d+-/.test(m[0])) errs.push(`unpkg asset without SRI: ${m[0].slice(0, 70)}…`);

// every getElementById target exists
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
for (const m of html.matchAll(/getElementById\(["'`]([^"'`]+)["'`]\)/g)) if (!ids.has(m[1])) errs.push(`getElementById("${m[1]}") has no matching element`);

if (errs.length) { console.error("CSP/STRUCTURE AUDIT FAILED:"); for (const e of errs) console.error("  ✗ " + e); process.exit(1); }
console.log(`CSP/structure audit passed: ${usedHosts.length} loaded hosts all allowed; connect-src + unpkg SRI ok; ${ids.size} element ids resolved.`);
