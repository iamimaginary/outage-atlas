// Programmatic SEO area pages (handoff Phase 4) — the compounding acquisition floor. Generates one
// static, indexable page per county at /outage/<st>/<slug>, plus per-state and national indexes, and
// rewrites sitemap.xml. Each page has UNIQUE title/description/canonical/H1 and a real static paragraph
// (not a thin doorway), then hydrates live status client-side from the tracker-data snapshot — so the
// page is meaningful to crawlers offline AND live for humans. Dependency-free.
//
//   node scripts/gen_area_pages.mjs
//
// County source (first that exists): $AREA_SOURCE → data/national/baseline.json (all counties ever
// seen, at collect time) → scripts/data/seed-counties.json (bundled seed). Committed to the code
// branch (GitHub Pages serves it); re-run when the county set changes.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE_BASE || "https://outageatlas.com").replace(/\/$/, "");
const REPO = "iamimaginary/outage-atlas";
const DATA_BASE = `https://raw.githubusercontent.com/${REPO}/tracker-data/national/baseline.json`;
const OUT_DIR = join(ROOT, "outage");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const STATE_NAMES = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",PR:"Puerto Rico" };
const stName = (st) => STATE_NAMES[st] || st;

function loadCounties() {
  const src = process.env.AREA_SOURCE;
  const tryFiles = [src, join(ROOT, "data/national/baseline.json"), join(ROOT, "scripts/data/seed-counties.json")].filter(Boolean);
  for (const f of tryFiles) {
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, "utf8"));
    const rows = Array.isArray(j) ? j : Object.values(j.counties || j);
    const seen = new Set(), out = [];
    for (const r of rows) {
      const fips = String(r.fips || "").padStart(5, "0");
      if (!/^\d{5}$/.test(fips) || !r.county || !r.state || seen.has(fips)) continue;
      seen.add(fips); out.push({ fips, county: r.county, state: r.state });
    }
    if (out.length) { console.log(`area pages: ${out.length} counties from ${f}`); return out; }
  }
  throw new Error("no county source found");
}

// shared minimal shell (dark brand, no external deps) — no map/leaflet on area pages, so a tight CSP.
const head = ({ title, desc, canonical, robots = "index,follow" }) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://ornl.opendatasoft.com; img-src 'self' data:; style-src 'self' 'unsafe-inline';">
<meta name="robots" content="${robots}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0d1117">
<link rel="manifest" href="/manifest.json"><link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Outage Atlas">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og/og-default.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${SITE}/og/og-default.png">
<style>:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#9da7b3;--acc:#58a6ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{padding:16px;border-bottom:1px solid var(--line)}a{color:var(--acc)}main{max-width:820px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:0 0 4px}.big{font-size:34px;font-weight:700}.muted{color:var(--mut)}.small{font-size:13px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:14px}
.eta{margin-top:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#0b1f17}.eta.bad{background:#1f0f0b}
input,button{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button.primary{background:var(--acc);color:#04101f;border-color:var(--acc);font-weight:600;cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1 1 200px}.links a{margin-right:12px;display:inline-block}
footer{color:var(--mut);font-size:12px;padding:18px 16px;border-top:1px solid var(--line);margin-top:22px}</style>
</head>`;

const subscribeForm = (fips) => `<div class="panel">
  <div><b>🔔 Alert me when this area loses power</b></div>
  <div class="small muted" style="margin-top:4px">Free email alerts on an outage here — and an all-clear when it's over. No tracking; unsubscribe any time.</div>
  <div class="row" style="margin-top:8px"><input id="e" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email"><button class="primary" id="s">Alert me</button></div>
  <input id="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
  <div class="small" id="m" style="margin-top:6px"></div>
  <script>
  var FIPS=${JSON.stringify(fips)};
  function sub(){var em=document.getElementById('e').value.trim(),m=document.getElementById('m');
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)){m.style.color='#d29922';m.textContent='Enter a valid email address.';return;}
    var b=document.getElementById('s');b.disabled=true;m.style.color='#9da7b3';m.textContent='Signing you up…';
    fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,fips:FIPS,hp:document.getElementById('hp').value})})
      .then(function(r){if(r.ok){m.style.color='#3fb950';m.textContent='Almost there — check your inbox to confirm.';document.getElementById('e').value='';}
        else if(r.status===503){m.style.color='#d29922';m.textContent="Alerts aren't enabled yet — check back soon.";}
        else{m.style.color='#d29922';m.textContent='Could not sign you up right now. Please try again later.';}})
      .catch(function(){m.style.color='#d29922';m.textContent='Could not reach the server. Please try again later.';})
      .then(function(){b.disabled=false;});}
  document.getElementById('s').onclick=sub;
  document.getElementById('e').addEventListener('keydown',function(ev){if(ev.key==='Enter')sub();});
  </script>
</div>`;

function areaPage({ fips, county, state }, siblings) {
  const canonical = `${SITE}/outage/${state.toLowerCase()}/${slug(county)}`;
  const title = `Power outage in ${county}, ${state} — live status, customers affected, ETA | Outage Atlas`;
  const desc = `Live power-outage status for ${county}, ${state}: how many customers are without power right now, active weather alerts, and an estimated recovery time. Free, updated ~every 15 minutes.`;
  const nearby = siblings.filter((s) => s.fips !== fips).slice(0, 8)
    .map((s) => `<a href="/outage/${s.state.toLowerCase()}/${slug(s.county)}">${esc(s.county)}</a>`).join(" · ");
  const body = `<body>
<header><a href="/">← Outage Atlas</a></header>
<main>
  <h1>Power outage in ${esc(county)}, ${esc(state)}</h1>
  <div class="muted small">Live outage status · ${esc(stName(state))}</div>
  <div class="panel" id="status"><div class="muted">Loading live status…</div></div>
  <p class="muted small">This page tracks power outages in <b>${esc(county)}, ${esc(stName(state))}</b> using the free public
    <a href="https://odin.ornl.gov/" rel="noopener">ODIN</a> (DOE/ORNL) county outage feed and <a href="https://www.weather.gov/" rel="noopener">NWS</a>
    weather alerts, refreshed about every 15 minutes. It shows how many customers are currently without power in the county,
    any active weather alerts, and an algorithmic recovery estimate that every ZIP code in ${esc(county)} inherits. For
    address- or ZIP-level detail and your specific serving utility, open the <a href="/?q=${encodeURIComponent(county + ", " + state)}">full Outage Atlas map</a>.</p>
  ${subscribeForm(fips)}
  <div class="panel">
    <div class="small muted">Nearby & related areas</div>
    <div class="links small" style="margin-top:6px">${nearby || `<a href="/outage/${state.toLowerCase()}/">All ${esc(stName(state))} areas</a>`}</div>
    <div class="small" style="margin-top:8px"><a href="/outage/${state.toLowerCase()}/">All ${esc(stName(state))} outage pages</a> · <a href="/outage/">All states</a></div>
  </div>
</main>
<footer>Outage counts are customers reported out; coverage varies by utility participation. <b>Unofficial — not affiliated with any utility.</b> Data: ODIN (DOE/ORNL) + NWS. <a href="/">Outage Atlas</a>.</footer>
<script>
(function(){var FIPS=${JSON.stringify(fips)};
 fetch('${DATA_BASE}',{cache:'no-store'}).then(function(r){return r.json();}).then(function(b){
   var c=b.counties&&b.counties[FIPS];var el=document.getElementById('status');
   if(!c||!c.out){el.innerHTML='<div class="big">0</div><div class="muted">No active outages reported in ${esc(county)} right now.</div>';return;}
   var eta=c.eta&&c.eta.label?'<div class="eta'+(c.eta.kind==='rising'?' bad':'')+'">Recovery estimate: <b>'+c.eta.label+'</b></div>':'';
   var etr=c.etr?' · earliest ETR '+new Date(c.etr).toLocaleString():'';
   el.innerHTML='<div class="big">'+c.out.toLocaleString()+'</div><div class="muted">customers without power in ${esc(county)}, ${esc(state)}</div>'
     +'<div class="small muted" style="margin-top:4px">'+(c.incidents||0)+' active incident(s)'+etr+'</div>'+eta;
 }).catch(function(){document.getElementById('status').innerHTML='<div class="muted">Live data temporarily unavailable — see the <a href="/?q=${encodeURIComponent(county + ", " + state)}">full map</a>.</div>';});
})();
</script>
</body></html>`;
  return head({ title, desc, canonical }) + body;
}

function stateIndex(state, areas) {
  const canonical = `${SITE}/outage/${state.toLowerCase()}/`;
  const title = `Power outages in ${stName(state)} — live status by county | Outage Atlas`;
  const desc = `Live power-outage status by county across ${stName(state)}. Free, updated ~every 15 minutes from public ODIN + NWS data.`;
  const list = areas.sort((a, b) => a.county.localeCompare(b.county))
    .map((a) => `<li><a href="/outage/${state.toLowerCase()}/${slug(a.county)}">${esc(a.county)} County</a></li>`).join("");
  return head({ title, desc, canonical }) + `<body><header><a href="/">← Outage Atlas</a></header><main>
<h1>Power outages in ${esc(stName(state))}</h1>
<div class="muted small">Live outage status by county · updated ~every 15 minutes</div>
<div class="panel"><ul>${list}</ul></div>
<div class="small"><a href="/outage/">All states</a></div></main>
<footer><b>Unofficial — not affiliated with any utility.</b> Data: ODIN (DOE/ORNL) + NWS. <a href="/">Outage Atlas</a>.</footer></body></html>`;
}

function nationalIndex(byState) {
  const canonical = `${SITE}/outage/`;
  const title = `Power outages by state — live US outage map | Outage Atlas`;
  const desc = `Live power-outage status across the United States, by state and county. Free national baseline, updated ~every 15 minutes.`;
  const list = Object.keys(byState).sort((a, b) => stName(a).localeCompare(stName(b)))
    .map((st) => `<li><a href="/outage/${st.toLowerCase()}/">${esc(stName(st))}</a> <span class="muted small">(${byState[st].length})</span></li>`).join("");
  return head({ title, desc, canonical }) + `<body><header><a href="/">← Outage Atlas</a></header><main>
<h1>Power outages by state</h1><div class="muted small">Live US outage status — pick a state</div>
<div class="panel"><ul>${list}</ul></div></main>
<footer><b>Unofficial — not affiliated with any utility.</b> Data: ODIN (DOE/ORNL) + NWS. <a href="/">Outage Atlas</a>.</footer></body></html>`;
}

function writeSitemap(urls) {
  const today = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
  const body = urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${u.includes("/outage/") && u.split("/").length > 5 ? "always" : "daily"}</changefreq></url>`).join("\n");
  writeFileSync(join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by scripts/gen_area_pages.mjs — do not edit by hand. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

(function main() {
  const counties = loadCounties();
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true }); // clean rebuild
  const byState = {};
  for (const c of counties) (byState[c.state] = byState[c.state] || []).push(c);

  const urls = [`${SITE}/`, `${SITE}/outage/`];
  for (const st of Object.keys(byState)) {
    const dir = join(OUT_DIR, st.toLowerCase());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), stateIndex(st, byState[st]));
    urls.push(`${SITE}/outage/${st.toLowerCase()}/`);
    for (const c of byState[st]) {
      writeFileSync(join(dir, `${slug(c.county)}.html`), areaPage(c, byState[st]));
      urls.push(`${SITE}/outage/${st.toLowerCase()}/${slug(c.county)}`);
    }
  }
  writeFileSync(join(OUT_DIR, "index.html"), nationalIndex(byState));
  writeSitemap(urls);
  console.log(`generated ${counties.length} area pages across ${Object.keys(byState).length} states; sitemap has ${urls.length} URLs`);
})();
