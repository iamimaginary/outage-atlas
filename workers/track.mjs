// Analytics ingest — the public, cookieless visit beacon. Deployed at the SITE ORIGIN path
// `/api/track` so the page POSTs same-origin (page CSP stays `connect-src 'self'`).
//
// PRIVACY (guardrail): stores NO ip, NO user-agent, NO full referrer, NO cookie, NO persistent id.
// It derives a daily-rotating one-way `vid` (see workers/lib/db.mjs hashVid) purely to count uniques
// per day. If the D1 binding (env.ANALYTICS_DB) is absent, it silently succeeds (feature just off).
//
// Body: { type, path, ref, meta? }  — type ∈ pageview|search|deep|cta|alert.

import { insertEvent, ensureSchema, pruneOld, hashVid, classifyDevice, dayOf, refHost, isEventType } from "./lib/db.mjs";

const RETAIN_DAYS = 90;      // rolling retention window
const PRUNE_PROB = 0.02;     // ~2% of writes also prune old rows (no cron needed)

const res = (status, body) => new Response(body ? JSON.stringify(body) : null, {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

// Per-type sanitization of the client-supplied `path` (never trusted).
function cleanPath(type, raw) {
  const s = String(raw || "").slice(0, 120);
  if (type === "search") return s.toUpperCase().replace(/[^A-Z0-9 ,.-]/g, "").trim().slice(0, 40);
  // pageview/deep/etc: keep a path only — strip origin, query, hash.
  let p = s;
  try { p = new URL(s, "https://x/").pathname; } catch { /* keep s */ }
  return p.replace(/[^\w/.-]/g, "").slice(0, 120) || "/";
}

export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") return res(204);
    if (request.method !== "POST") return res(405, { error: "method not allowed" });

    let body = {};
    try { body = await request.json(); } catch { try { body = JSON.parse(await request.text() || "{}"); } catch { body = {}; } }

    const type = isEventType(body.type) ? body.type : "pageview";
    const db = env.ANALYTICS_DB;
    if (!db) return res(204); // analytics not provisioned → accept & drop

    const now = Date.now();
    const day = dayOf(now);
    const ua = request.headers.get("User-Agent") || "";
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const country = (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "";

    const ev = {
      ts: now, day, type,
      path: cleanPath(type, body.path),
      ref: refHost(body.ref || request.headers.get("Referer") || ""),
      country: String(country).slice(0, 2).toUpperCase(),
      device: classifyDevice(ua),
      meta: (() => { try { return JSON.stringify(body.meta || {}).slice(0, 200); } catch { return ""; } })(),
      vid: await hashVid(ip, ua, day, env.VID_SALT),
    };

    try {
      await insertEvent(db, ev);
    } catch (e) {
      // first write on a fresh DB: create schema, then retry once
      try { await ensureSchema(db); await insertEvent(db, ev); } catch { return res(204); }
    }
    // opportunistic retention prune (no separate cron)
    try { if (cryptoPct() < PRUNE_PROB) await pruneOld(db, RETAIN_DAYS, day); } catch { /* ignore */ }

    return res(204);
  },
};

// small deterministic-free % in [0,1) using crypto (Math.random is fine here too, but keep one source)
function cryptoPct() {
  const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 0xffffffff;
}
