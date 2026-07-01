// Unit tests for the admin-portal backend: the privacy-preserving analytics layer (workers/lib/db.mjs)
// and the Cloudflare Access verification (workers/lib/access.mjs). These cover the security/privacy-
// critical, pure logic — settings allowlisting, https-only link validation, the daily-rotating anonymous
// visitor token, and JWT claim checks. D1 SQL correctness is verified against live D1 after deploy (it
// can't run in CI); here a recording mock asserts each function's contract with the D1 API. No network.
import {
  dayOf, classifyDevice, hashVid, refHost, fillTimeseries,
  sanitizeSettings, publicSettings, SETTINGS_DEFAULTS,
  insertEvent, getSettings, putSettings, stats,
} from "../workers/lib/db.mjs";
import { parseJwt, checkClaims } from "../workers/lib/access.mjs";

let failed = 0;
const ok = (c, m) => { if (c) console.log("✓ " + m); else { failed++; console.error("✗ " + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`);

// ---------- pure analytics helpers ----------------------------------------------------------------
eq(dayOf(Date.UTC(2026, 5, 30, 23, 59)), "2026-06-30", "dayOf → UTC YYYY-MM-DD");
ok(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile/15E148") === "mobile", "classifyDevice iPhone → mobile");
ok(classifyDevice("Mozilla/5.0 (iPad; CPU OS)") === "tablet", "classifyDevice iPad → tablet");
ok(classifyDevice("Mozilla/5.0 (X11; Linux x86_64)") === "desktop", "classifyDevice desktop");
ok(classifyDevice("Googlebot/2.1 (+http://www.google.com/bot.html)") === "bot", "classifyDevice bot");
ok(classifyDevice("") === "unknown", "classifyDevice empty → unknown");

eq(refHost("https://www.google.com/search?q=x"), "google.com", "refHost strips www + path/query");
eq(refHost("not a url"), "", "refHost invalid → empty");

// privacy: vid is one-way, 16 hex, deterministic per (ip,ua,day,salt) and ROTATES with the day.
const vidA = await hashVid("1.2.3.4", "UA", "2026-06-30", "salt");
const vidA2 = await hashVid("1.2.3.4", "UA", "2026-06-30", "salt");
const vidB = await hashVid("1.2.3.4", "UA", "2026-07-01", "salt"); // next day
ok(/^[0-9a-f]{16}$/.test(vidA), "hashVid → 16 hex chars");
ok(vidA === vidA2, "hashVid deterministic within a day");
ok(vidA !== vidB, "hashVid ROTATES daily (privacy: no cross-day identity)");
ok(!vidA.includes("1.2.3.4"), "hashVid one-way (no raw ip embedded)");

// dense timeseries: 5-day window ending 2026-06-30 with one sparse row
const ts = fillTimeseries([{ day: "2026-06-29", views: 10, uniques: 4 }], 5, "2026-06-30");
ok(ts.length === 5, "fillTimeseries length == days");
eq(ts[0].day, "2026-06-26", "fillTimeseries starts days-1 back");
eq(ts[4], { day: "2026-06-30", views: 0, uniques: 0 }, "fillTimeseries pads missing days with 0");
eq(ts[3], { day: "2026-06-29", views: 10, uniques: 4 }, "fillTimeseries keeps present-day counts");

// ---------- settings allowlist / sanitization (security surface) ----------------------------------
const dirty = {
  ads: { provider: "evil", clientId: "ca-pub-123<script>", slot: "s!@#1", enabled: true },
  affiliates: { ecoflow: "javascript:alert(1)", jackery: "https://go.jackery.com/x", other: "https://x" },
  leadEndpoint: "https://evil.example/steal",
  flags: { leadgen: false, alerts: "true", deepView: 0, secret: true },
  banner: { enabled: 1, text: "<b>hi</b>".repeat(50), level: "nuclear", href: "http://insecure" },
  extraTopLevel: "dropme",
};
const s = sanitizeSettings(dirty);
ok(s.ads.provider === "none", "sanitize: unknown ad provider → none");
ok(s.ads.enabled === false, "sanitize: enabled forced false when provider none");
ok(s.ads.clientId === "ca-pub-123script", "sanitize: clientId stripped to id chars");
ok(s.affiliates.ecoflow === "", "sanitize: non-https affiliate link dropped (no javascript:)");
ok(s.affiliates.jackery === "https://go.jackery.com/x", "sanitize: https affiliate link kept");
ok(!("other" in s.affiliates), "sanitize: unknown affiliate key dropped");
ok(s.leadEndpoint === SETTINGS_DEFAULTS.leadEndpoint, "sanitize: non-path leadEndpoint → default");
ok(sanitizeSettings({}).leadEndpoint === "/api/lead", "sanitize: empty leadEndpoint → default (not '')");
ok(sanitizeSettings({ leadEndpoint: "/custom/lead" }).leadEndpoint === "/custom/lead", "sanitize: valid path leadEndpoint kept");
ok(s.flags.leadgen === false && s.flags.alerts === true && s.flags.deepView === false, "sanitize: flags coerced to bool");
ok(!("secret" in s.flags), "sanitize: unknown flag dropped");
ok(s.banner.level === "info", "sanitize: unknown banner level → info");
ok(s.banner.href === "", "sanitize: http banner href dropped (https only)");
ok(s.banner.text.length <= 280, "sanitize: banner text clamped");
ok(!("extraTopLevel" in s), "sanitize: unknown top-level key dropped");

// adsense enable path works when a real provider is chosen
const s2 = sanitizeSettings({ ads: { provider: "adsense", clientId: "ca-pub-9", enabled: true } });
ok(s2.ads.provider === "adsense" && s2.ads.enabled === true, "sanitize: adsense + enabled honored");

// publicSettings exposes exactly the public surface
const pub = publicSettings(dirty);
eq(Object.keys(pub).sort(), ["ads", "affiliates", "banner", "flags", "leadEndpoint"], "publicSettings key set");

// ---------- recording D1 mock: asserts each fn's contract with the D1 API ------------------------
function keyFor(sql) {
  if (/SELECT v FROM settings/.test(sql)) return "settingsRow";
  if (/GROUP BY day/.test(sql)) return "series";
  if (/COUNT\(DISTINCT vid\).*type='pageview'/.test(sql) && !/GROUP BY/.test(sql)) return "totals";
  if (/type='search'/.test(sql) && /path AS k/.test(sql)) return "searches";
  if (/path AS k/.test(sql)) return "paths";
  if (/ref AS k/.test(sql)) return "refs";
  if (/country AS k/.test(sql)) return "countries";
  if (/device AS k/.test(sql)) return "devices";
  if (/type AS k/.test(sql)) return "types";
  return "?";
}
function recDb(canned = {}) {
  const calls = [];
  const mk = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    async run() { calls.push({ op: "run", sql, args: this.args }); return { success: true }; },
    async all() { calls.push({ op: "all", sql, args: this.args }); return { results: canned[keyFor(sql)] || [] }; },
    async first() { calls.push({ op: "first", sql, args: this.args }); const r = canned[keyFor(sql)]; return Array.isArray(r) ? r[0] : (r || null); },
  });
  return { prepare: (sql) => mk(sql), batch: async (ss) => { for (const x of ss) calls.push({ op: "batch", sql: x.sql }); return ss.map(() => ({ success: true })); }, _calls: calls };
}

// insertEvent binds all 9 columns
const dbi = recDb();
await insertEvent(dbi, { ts: 1, day: "2026-06-30", type: "pageview", path: "/", ref: "", country: "US", device: "mobile", meta: "", vid: "abc" });
const ins = dbi._calls.find((c) => /INSERT INTO events/.test(c.sql));
ok(ins && ins.args.length === 9, "insertEvent binds 9 columns");
ok(ins.args[5] === "US" && ins.args[6] === "mobile", "insertEvent maps country/device positions");

// putSettings sanitizes before persisting; getSettings parses + sanitizes on read
const dbp = recDb();
await putSettings(dbp, { ads: { provider: "adsense", clientId: "ca-pub-1", enabled: true }, banner: { enabled: true, text: "hi", href: "https://x.com" } }, 1234);
const put = dbp._calls.find((c) => /INSERT INTO settings/.test(c.sql));
const persisted = JSON.parse(put.args[0]);
ok(persisted.ads.provider === "adsense" && persisted.ads.enabled === true, "putSettings persists sanitized settings");
ok(put.args[1] === 1234, "putSettings stores updated_at");

const dbg = recDb({ settingsRow: [{ v: JSON.stringify({ flags: { leadgen: false }, ads: { provider: "adsense", clientId: "ca-pub-2", enabled: true } }) }] });
const got = await getSettings(dbg);
ok(got.flags.leadgen === false && got.ads.provider === "adsense", "getSettings round-trips stored JSON through sanitize");

// stats assembles totals + dense timeseries + passthrough top-N
const dbs = recDb({
  series: [{ day: "2026-06-29", views: 20, uniques: 8 }, { day: "2026-06-30", views: 5, uniques: 3 }],
  totals: [{ views: 25, uniques: 11 }],
  paths: [{ k: "/", n: 20 }], searches: [{ k: "44113", n: 4 }],
  refs: [{ k: "google.com", n: 9 }], countries: [{ k: "US", n: 22 }],
  devices: [{ k: "mobile", n: 15 }], types: [{ k: "pageview", n: 25 }],
});
const st = await stats(dbs, { days: 7, today: "2026-06-30" });
ok(st.totals.pageviews === 25 && st.totals.uniques === 11, "stats totals from the totals row");
ok(st.timeseries.length === 7, "stats timeseries densified to `days`");
ok(st.timeseries[6].views === 5, "stats timeseries carries the latest day");
eq(st.topSearches, [{ k: "44113", n: 4 }], "stats passes through top searches");
eq(st.range, { days: 7, start: "2026-06-24", end: "2026-06-30" }, "stats range window");

// ---------- Cloudflare Access JWT verification (auth boundary) ------------------------------------
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mkJwt = (payload) => `${b64url({ alg: "RS256", kid: "k1" })}.${b64url(payload)}.c2ln`; // sig unused by parse/check

const parsed = parseJwt(mkJwt({ email: "a@b.com", aud: ["AUD1"], exp: 9999999999 }));
ok(parsed.header.kid === "k1" && parsed.payload.email === "a@b.com", "parseJwt decodes header + payload");
ok(parsed.signingInput.split(".").length === 2, "parseJwt exposes signingInput (header.payload)");
let threw = false; try { parseJwt("not.a"); } catch { threw = true; } ok(threw, "parseJwt rejects malformed token");

const NOW = 1_000_000; // seconds
eq(checkClaims({ email: "a@b.com", aud: "AUD1", exp: NOW + 100 }, { aud: "AUD1", now: NOW }), "a@b.com", "checkClaims returns email on valid token");
const throwsWith = (payload, opts, why) => { let t = false; try { checkClaims(payload, opts); } catch { t = true; } ok(t, why); };
throwsWith({ aud: "AUD1", exp: NOW - 1 }, { aud: "AUD1", now: NOW }, "checkClaims rejects expired token");
throwsWith({ aud: "OTHER", exp: NOW + 100 }, { aud: "AUD1", now: NOW }, "checkClaims rejects audience mismatch");
throwsWith({ email: "x@y.com", aud: "AUD1", exp: NOW + 100 }, { aud: "AUD1", now: NOW, emails: ["ok@z.com"] }, "checkClaims enforces email allowlist");
eq(checkClaims({ email: "OK@Z.com", aud: "AUD1", exp: NOW + 100 }, { aud: "AUD1", now: NOW, emails: ["ok@z.com"] }), "OK@Z.com", "checkClaims email allowlist is case-insensitive");

console.log(`\n${failed ? failed + " FAILED" : "all admin tests passed"}`);
process.exit(failed ? 1 : 0);
