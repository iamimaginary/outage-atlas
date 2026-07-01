// Storage layer for the admin portal — Cloudflare D1 (SQLite). Two things live here:
//   1. `events`   — cookieless, PII-free visit rows (privacy-preserving aggregate analytics).
//   2. `settings` — a single JSON blob of runtime-editable config (ads / affiliates / flags / banner).
//
// PRIVACY (guardrail): we NEVER store an IP, a full referrer URL, a user-agent string, or any
// persistent per-person identifier. The only "who" column is `vid`: a SHA-256 hash of
// (ip + ua + day + secret) truncated to 16 hex chars. It ROTATES DAILY (the day is in the hash) and
// is one-way, so it lets us count unique visitors *per day* without ever identifying or cross-day
// tracking anyone. No cookies are set. This keeps the site's "No tracking" promise honest.
//
// The functions here take a D1 handle (`env.ANALYTICS_DB`) — the platform binding. The pure helpers
// (hashVid / classifyDevice / dayOf / fillTimeseries / sanitizeSettings / publicSettings) are exported
// separately so they can be unit-tested with no database (scripts/test_admin.mjs).

// ---- pure helpers (unit-tested) -------------------------------------------------------------------

const EVENT_TYPES = new Set(["pageview", "search", "deep", "cta", "alert"]);
export const isEventType = (t) => EVENT_TYPES.has(t);

// UTC day string YYYY-MM-DD from an epoch-ms timestamp.
export const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// Coarse device class from a UA string. Buckets only — never stored raw.
export function classifyDevice(ua = "") {
  const s = String(ua).toLowerCase();
  if (!s) return "unknown";
  if (/bot|crawl|spider|slurp|bingpreview|headless|curl|wget|python-|node-fetch/.test(s)) return "bot";
  if (/ipad|tablet|playbook|silk|kindle/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|phone|windows phone/.test(s)) return "mobile";
  return "desktop";
}

// One-way, daily-rotating visitor token. Web Crypto → runs in Workers AND Node 20+ (globalThis.crypto).
export async function hashVid(ip, ua, day, secret) {
  const data = new TextEncoder().encode(`${ip || ""}|${ua || ""}|${day}|${secret || "atlas"}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// Referrers are reduced to a bare host (no path, no query, no PII) before storage.
export function refHost(ref = "") {
  if (!ref) return "";
  try { return new URL(ref).hostname.replace(/^www\./, "").slice(0, 80); }
  catch { return ""; }
}

// Turn sparse per-day count rows into a dense, oldest→newest series of length `days` ending at `today`.
export function fillTimeseries(rows, days, today) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const end = new Date(today + "T00:00:00Z").getTime();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(d) || {};
    out.push({ day: d, views: Number(r.views || 0), uniques: Number(r.uniques || 0) });
  }
  return out;
}

// The editable settings shape + defaults. Anything not in DEFAULTS is dropped on save (allowlist), so
// the settings blob can never smuggle arbitrary keys into the public config.
export const SETTINGS_DEFAULTS = Object.freeze({
  ads: { provider: "none", clientId: "", slot: "", enabled: false }, // provider: none|adsense
  affiliates: { ecoflow: "", jackery: "" },
  leadEndpoint: "/api/lead",
  flags: { leadgen: true, alerts: true, deepView: true }, // public feature toggles
  banner: { enabled: false, text: "", level: "info", href: "" }, // site-wide announcement
});

const clampStr = (v, n) => String(v ?? "").slice(0, n);
const bool = (v) => v === true || v === "true" || v === 1 || v === "1";

// Validate/normalize an incoming settings object against the allowlist. Never trusts client input.
export function sanitizeSettings(input = {}) {
  const d = SETTINGS_DEFAULTS, i = input || {};
  const ai = i.ads || {};
  const provider = ["none", "adsense"].includes(ai.provider) ? ai.provider : "none";
  const affIn = i.affiliates || {};
  const fl = i.flags || {};
  const bn = i.banner || {};
  const level = ["info", "warn", "alert"].includes(bn.level) ? bn.level : "info";
  return {
    ads: {
      provider,
      // AdSense ids look like ca-pub-#########; keep it strict-ish but don't hard-reject formats we
      // don't know — just length-clamp and strip anything that isn't id-ish.
      clientId: clampStr(ai.clientId, 40).replace(/[^a-zA-Z0-9-]/g, ""),
      slot: clampStr(ai.slot, 40).replace(/[^a-zA-Z0-9-]/g, ""),
      enabled: bool(ai.enabled) && provider !== "none",
    },
    affiliates: {
      ecoflow: httpsOnly(clampStr(affIn.ecoflow, 400)),
      jackery: httpsOnly(clampStr(affIn.jackery, 400)),
    },
    leadEndpoint: clampStr(i.leadEndpoint || d.leadEndpoint, 200).startsWith("/") ? clampStr(i.leadEndpoint, 200) : d.leadEndpoint,
    flags: {
      leadgen: fl.leadgen === undefined ? d.flags.leadgen : bool(fl.leadgen),
      alerts: fl.alerts === undefined ? d.flags.alerts : bool(fl.alerts),
      deepView: fl.deepView === undefined ? d.flags.deepView : bool(fl.deepView),
    },
    banner: {
      enabled: bool(bn.enabled),
      text: clampStr(bn.text, 280),
      level,
      href: httpsOnly(clampStr(bn.href, 400)),
    },
  };
}

// Affiliate/banner links are rendered into the public page → only allow absolute https URLs (or empty).
function httpsOnly(v) {
  if (!v) return "";
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v : "";
}

// The subset of settings safe to expose on the PUBLIC /api/config (everything here is already public —
// affiliate ids live in outbound links, ad ids are public — but we still route through an allowlist).
export function publicSettings(s) {
  const v = sanitizeSettings(s);
  return { ads: v.ads, affiliates: v.affiliates, leadEndpoint: v.leadEndpoint, flags: v.flags, banner: v.banner };
}

// ---- D1-backed functions ---------------------------------------------------------------------------

export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      ts INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL,
      path TEXT, ref TEXT, country TEXT, device TEXT, meta TEXT, vid TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_day_type ON events(day, type)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER)`),
  ]);
}

// Insert one visit event. `ev` is already sanitized/derived by the caller (workers/track.mjs).
export async function insertEvent(db, ev) {
  await db.prepare(
    `INSERT INTO events (ts, day, type, path, ref, country, device, meta, vid) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(ev.ts, ev.day, ev.type, ev.path || "", ev.ref || "", ev.country || "", ev.device || "", ev.meta || "", ev.vid || "").run();
}

// Best-effort retention: drop rows older than `keepDays`. Called probabilistically from the ingest path
// so there's no separate cron to provision. Aggregates are unaffected within the window.
export async function pruneOld(db, keepDays, today) {
  const cutoff = new Date(new Date(today + "T00:00:00Z").getTime() - keepDays * 86400000).toISOString().slice(0, 10);
  await db.prepare(`DELETE FROM events WHERE day < ?`).bind(cutoff).run();
}

export async function getSettings(db) {
  const row = await db.prepare(`SELECT v FROM settings WHERE k = 'site'`).first();
  if (!row) return sanitizeSettings({});
  try { return sanitizeSettings(JSON.parse(row.v)); } catch { return sanitizeSettings({}); }
}

export async function putSettings(db, obj, now) {
  const clean = sanitizeSettings(obj);
  await db.prepare(`INSERT INTO settings (k, v, updated_at) VALUES ('site', ?, ?)
                    ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(clean), now).run();
  return clean;
}

const rowsOf = (res) => (res && res.results) || [];

// Aggregate analytics for the dashboard. `days` = window size; `today` = UTC day string (deterministic).
export async function stats(db, { days = 30, today } = {}) {
  const start = new Date(new Date(today + "T00:00:00Z").getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const q = (sql) => db.prepare(sql).bind(start);

  const [series, totalRow, paths, refs, countries, devices, searches, types] = await Promise.all([
    q(`SELECT day, COUNT(*) AS views, COUNT(DISTINCT vid) AS uniques FROM events WHERE day >= ? GROUP BY day ORDER BY day`).all(),
    q(`SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS uniques FROM events WHERE day >= ? AND type='pageview'`).first(),
    q(`SELECT path AS k, COUNT(*) AS n FROM events WHERE day >= ? AND type='pageview' AND path <> '' GROUP BY path ORDER BY n DESC LIMIT 15`).all(),
    q(`SELECT ref AS k, COUNT(*) AS n FROM events WHERE day >= ? AND ref <> '' GROUP BY ref ORDER BY n DESC LIMIT 15`).all(),
    q(`SELECT country AS k, COUNT(*) AS n FROM events WHERE day >= ? AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 15`).all(),
    q(`SELECT device AS k, COUNT(*) AS n FROM events WHERE day >= ? GROUP BY device ORDER BY n DESC`).all(),
    q(`SELECT path AS k, COUNT(*) AS n FROM events WHERE day >= ? AND type='search' AND path <> '' GROUP BY path ORDER BY n DESC LIMIT 20`).all(),
    q(`SELECT type AS k, COUNT(*) AS n FROM events WHERE day >= ? GROUP BY type ORDER BY n DESC`).all(),
  ]);

  const tr = totalRow || {};
  return {
    range: { days, start, end: today },
    totals: {
      pageviews: Number(tr.views || 0),
      uniques: Number(tr.uniques || 0),
    },
    timeseries: fillTimeseries(rowsOf(series), days, today),
    topPaths: rowsOf(paths),
    topReferrers: rowsOf(refs),
    topCountries: rowsOf(countries),
    devices: rowsOf(devices),
    topSearches: rowsOf(searches),
    eventTypes: rowsOf(types),
  };
}
