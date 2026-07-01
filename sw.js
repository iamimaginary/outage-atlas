// Outage Atlas service worker — vanilla, dependency-free. Three jobs:
//   1. cache-first app SHELL (same-origin html/modules/icons) so the app opens instantly + offline;
//   2. network-first LIVE DATA (the tracker-data snapshot on raw.githubusercontent) with a
//      cache fallback, so an offline visit shows the last-known outage snapshot;
//   3. stale-while-revalidate for pinned 3rd-party libs (Leaflet) + cache-first for map tiles.
// Volatile geo/live API calls (ODIN export, NWS, FCC, ArcGIS, geocoders) pass straight through to
// the network — caching them would serve stale locations/answers.
//
// Bump VERSION on any shell change to roll caches cleanly (old caches are dropped on activate).
//
// v2: fix "Response served by service worker has redirections" (Safari/WebKit). Cloudflare Pages
// 308-redirects /index.html -> /, so a cached/redirected Response can't fulfill a navigation in Safari.
// We now strip the redirect flag (rebuild the Response) on precache + navigation, and take over
// immediately (skipWaiting) so a poisoned v1 client self-heals on the next load.
const VERSION = "v4";
const SHELL = `atlas-shell-${VERSION}`;
const DATA = `atlas-data-${VERSION}`;
const LIB = `atlas-lib-${VERSION}`;
const TILES = `atlas-tiles-${VERSION}`;
const OURS = new Set([SHELL, DATA, LIB, TILES]);

// Same-origin runtime graph (verified: geo.mjs + odin.mjs are self-contained, no further imports).
const SHELL_ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./web/geo.mjs", "./adapters/odin.mjs", "./web/leadgen.mjs", "./web/push.mjs", "./config.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
];

const TILE_CAP = 300; // bound the tile cache so a lot of panning can't grow it without limit

// A Response with .redirected=true breaks navigations in Safari. Rebuild it as a plain Response.
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.clone().arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function precache() {
  const cache = await caches.open(SHELL);
  // Manual (not addAll) so one redirecting/missing asset can't fail the whole install, and so we can
  // store a de-redirected copy.
  await Promise.all(SHELL_ASSETS.map(async (url) => {
    try {
      const res = await fetch(new Request(url, { cache: "reload", redirect: "follow" }));
      if (res && res.ok) await cache.put(url, await clean(res));
    } catch { /* best effort */ }
  }));
}

self.addEventListener("install", (e) => {
  self.skipWaiting(); // take over ASAP so a broken v1 self-heals
  e.waitUntil(precache());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!OURS.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

// --- Web Push (payload-less): the push carries no data, so we read the user's saved area from IndexedDB
// and infer the event from the live baseline — out>0 => outage, 0/absent => restored. Tagged per county
// so it updates in place and the all-clear replaces the outage banner. ALWAYS ends in showNotification
// (the userVisibleOnly contract). ---
const PUSH_DATA_URL = "https://raw.githubusercontent.com/iamimaginary/outage-atlas/tracker-data/national/baseline.json";
function idbGet(key) {
  return new Promise((resolve) => {
    const r = indexedDB.open("outage-atlas", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => resolve(null);
    r.onsuccess = () => { try { const t = r.result.transaction("kv", "readonly").objectStore("kv").get(key); t.onsuccess = () => resolve(t.result || null); t.onerror = () => resolve(null); } catch { resolve(null); } };
  });
}
async function handlePush() {
  const prefs = (await idbGet("alertPrefs")) || {};
  const fips = prefs.fips, area = prefs.area || "your area", url = prefs.areaPath || "/";
  let out = null;
  try { if (fips) { const r = await fetch(PUSH_DATA_URL, { cache: "no-store" }); if (r.ok) { const b = await r.json(); const c = b.counties && b.counties[fips]; out = c ? (c.out || 0) : 0; } } } catch { /* fall through to generic */ }
  let title, body;
  if (out > 0) { title = `⚡ Power outage in ${area}`; body = `About ${out.toLocaleString()} customers without power. Tap for live status.`; }
  else if (out === 0) { title = `✅ Power restored in ${area}`; body = `Power is mostly back. Tap for details.`; }
  else { title = `⚡ Outage update — ${area}`; body = `Tap for live status.`; }
  await self.registration.showNotification(title, { body, tag: fips ? `outage-${fips}` : "outage", renotify: true, data: { url }, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png" });
}
self.addEventListener("push", (e) => e.waitUntil(handlePush()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) if ("focus" in c) { try { await c.navigate(url); } catch {} return c.focus(); }
    return self.clients.openWindow(url);
  })());
});

const isData = (u) => u.hostname === "raw.githubusercontent.com" && u.pathname.includes("/tracker-data/");
const isLib = (u) => u.hostname === "unpkg.com";
const isTile = (u) => u.hostname.endsWith("basemaps.cartocdn.com");

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error("offline and no cached copy");
  }
}

async function cacheFirst(req, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    cache.put(req, res.clone());
    if (cap) trim(cache, cap); // best-effort, don't block the response
  }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || fetch(req);
}

async function trim(cache, cap) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - cap; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never touch POSTs (e.g. OutageEntry-style feeds)
  const url = new URL(req.url);

  // App navigations: NETWORK-FIRST with a de-redirected response, so an online load never gets a cached
  // redirected response (the Safari "Response served by service worker has redirections" bug). Only fall
  // back to the cached shell when the network is unavailable (offline last-known page).
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try { return await clean(await fetch(req)); }
      catch { return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error(); }
    })());
    return;
  }
  if (isData(url)) return e.respondWith(networkFirst(req, DATA));
  if (isTile(url)) return e.respondWith(cacheFirst(req, TILES, TILE_CAP));
  if (isLib(url)) return e.respondWith(staleWhileRevalidate(req, LIB));
  if (url.origin === self.location.origin) return e.respondWith(cacheFirst(req, SHELL));
  // everything else (volatile live APIs) → straight to network
});
