// Outage Atlas service worker — vanilla, dependency-free. Three jobs:
//   1. cache-first app SHELL (same-origin html/modules/icons) so the app opens instantly + offline;
//   2. network-first LIVE DATA (the tracker-data snapshot on raw.githubusercontent) with a
//      cache fallback, so an offline visit shows the last-known outage snapshot;
//   3. stale-while-revalidate for pinned 3rd-party libs (Leaflet) + cache-first for map tiles.
// Volatile geo/live API calls (ODIN export, NWS, FCC, ArcGIS, geocoders) pass straight through to
// the network — caching them would serve stale locations/answers.
//
// Bump VERSION on any shell change to roll caches cleanly (old caches are dropped on activate).
const VERSION = "v1";
const SHELL = `atlas-shell-${VERSION}`;
const DATA = `atlas-data-${VERSION}`;
const LIB = `atlas-lib-${VERSION}`;
const TILES = `atlas-tiles-${VERSION}`;
const OURS = new Set([SHELL, DATA, LIB, TILES]);

// Same-origin runtime graph (verified: geo.mjs + odin.mjs are self-contained, no further imports).
const SHELL_ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./web/geo.mjs", "./adapters/odin.mjs",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
];

const TILE_CAP = 300; // bound the tile cache so a lot of panning can't grow it without limit

self.addEventListener("install", (e) => {
  // addAll is atomic: if any shell asset 404s, install fails loudly rather than half-caching.
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!OURS.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page posts {type:"SKIP_WAITING"} when the user accepts a "new version" prompt.
self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

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

  // App navigations: serve the cached shell, fall back to network (SPA-style resilience).
  if (req.mode === "navigate") {
    e.respondWith((async () => (await caches.match("./index.html")) || (await caches.match("./")) || fetch(req))());
    return;
  }
  if (isData(url)) return e.respondWith(networkFirst(req, DATA));
  if (isTile(url)) return e.respondWith(cacheFirst(req, TILES, TILE_CAP));
  if (isLib(url)) return e.respondWith(staleWhileRevalidate(req, LIB));
  if (url.origin === self.location.origin) return e.respondWith(cacheFirst(req, SHELL));
  // everything else (volatile live APIs) → straight to network
});
