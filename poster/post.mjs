// Auto-poster orchestrator (handoff §2.1) — the ONLY file with IO/clock/network. Runs AFTER the
// collector writes the snapshot (a `post` step in collect-baseline.yml). Loads the baseline + the
// persisted poster_state, runs the pure pipeline (detect -> select -> render -> publish), and writes
// state back so dedupe/throttle survive across runs.
//
//   node poster/post.mjs            # DRY-RUN unless POSTER_ENABLED=1 and creds present
//
// Safety (handoff §2.7): DRY-RUN by default (logs what WOULD post, changes nothing); a kill switch
// (POSTER_ENABLED != 1) disables posting; missing creds also force dry-run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectEvents, selectToPost, commitPost } from "./detect.mjs";
import { renderPost } from "./templates.mjs";
import { makeBluesky } from "./platforms/bluesky.mjs";
import { makeThreads } from "./platforms/threads.mjs";
import { makeX } from "./platforms/x.mjs";
import { matchSubscribers, deliverPush } from "./notify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.POSTER_DATA_DIR || join(ROOT, "data");
const STATE_PATH = join(DATA, "poster_state.json");
const SNAP_PATH = join(DATA, "national", "baseline.json");

const URL_BASE = (process.env.POSTER_URL_BASE || "https://outageatlas.com").replace(/\/$/, "");
const TZ = process.env.POSTER_TZ || "America/New_York";

const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d; } catch { return d; } };
const fmtTime = (ms) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ, timeZoneName: "short" }).format(new Date(ms));
const localHour = (ms) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date(ms)));
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Area link: the SEO area page (Phase 4) when we can build the path, else the app deep-linked by query.
function urlFor(e) {
  if (e.fips === "_rollup") return e.state ? `${URL_BASE}/?state=${e.state}` : URL_BASE;
  const st = (e.state || "").toLowerCase(), area = slug((e.name || "").split(",")[0]);
  return st && area ? `${URL_BASE}/outage/${st}/${area}` : `${URL_BASE}/?q=${encodeURIComponent(e.name || "")}`;
}

function enrich(e) {
  return { ...e, at: fmtTime(e.atTs), since: e.sinceTs ? fmtTime(e.sinceTs) : "", url: urlFor(e) };
}

(async () => {
  const now = Date.now();
  const snapshot = readJson(SNAP_PATH, null);
  if (!snapshot || !snapshot.counties) { console.error("poster: no baseline snapshot at", SNAP_PATH, "— nothing to do"); return; }
  const prevState = readJson(STATE_PATH, {});

  const { events, areaEvents, state } = detectEvents(prevState, snapshot, now);
  const selected = selectToPost(events, state, now, localHour(now));

  // --- subscriber alerts (Phase 3): reuse the per-area detection to PUSH to devices watching an area.
  // Independent of the social gate; DRY-RUN unless PUSH_ENABLED=1 + VAPID keys. Reads the subscriber
  // list from the bearer-gated /api/push-subscribers, and prunes dead subs (404/410) back through it. ---
  try {
    let subscribers = [];
    if (process.env.PUSH_SUBSCRIBERS_URL && process.env.PUSH_READ_TOKEN) {
      const rs = await fetch(process.env.PUSH_SUBSCRIBERS_URL, { headers: { Authorization: `Bearer ${process.env.PUSH_READ_TOKEN}` }, signal: AbortSignal.timeout(20000) });
      if (rs.ok) subscribers = (await rs.json()).subscribers || [];
    }
    const matches = matchSubscribers(areaEvents, subscribers);
    if (matches.length) {
      const res = await deliverPush(matches, {
        subject: process.env.VAPID_SUBJECT || "https://outageatlas.com",
        publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY,
        pruneUrl: process.env.PUSH_SUBSCRIBERS_URL, pruneToken: process.env.PUSH_READ_TOKEN,
      });
      console.log(`push alerts: ${matches.length} match(es) / ${subscribers.length} sub(s) — ${res.dryRun ? "DRY-RUN" : `sent ${res.sent}, pruned ${res.pruned}`}`);
    }
  } catch (e) { console.error("push alerts step failed (non-fatal):", e.message); }

  // Build every platform whose creds are present (handoff §2.6 — post to all enabled).
  const platforms = [];
  if (process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) platforms.push(makeBluesky({ handle: process.env.BLUESKY_HANDLE, appPassword: process.env.BLUESKY_APP_PASSWORD }));
  if (process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN) platforms.push(makeThreads({ userId: process.env.THREADS_USER_ID, accessToken: process.env.THREADS_ACCESS_TOKEN }));
  if (process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET) platforms.push(makeX({ apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET, accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET }));

  const enabled = process.env.POSTER_ENABLED === "1";
  const dryRun = !enabled || process.env.POSTER_DRY_RUN === "1" || platforms.length === 0;

  console.log(`poster: ${events.length} event(s) detected, ${selected.length} to post ${dryRun ? "(DRY-RUN — nothing published, no state written)" : `(LIVE → ${platforms.map((p) => p.name).join(", ")})`}`);
  for (const e of events) console.log(`  · ${e.type} ${e.fips} ${e.name || ""} out=${e.out ?? e.sumOut ?? ""}${selected.includes(e) ? "  → POST" : "  (held)"}`);

  if (dryRun) {
    for (const e of selected) { const { text } = renderPost(enrich(e), { url: urlFor(e) }); console.log(`\n  WOULD POST (${[...text].length}c):\n  ${text}\n`); }
    return; // dry-run is fully side-effect-free
  }

  // LIVE: publish each selected post to every platform; commit an event once at least one platform
  // accepted it (a fully-failed post keeps its dedup key free, so it retries next run).
  let liveState = state, posted = 0;
  for (const e of selected) {
    const { text, link } = renderPost(enrich(e), { url: urlFor(e) });
    let anyOk = false;
    for (const p of platforms) {
      try { const res = await p.publish({ text, link }, { createdAt: new Date(now).toISOString() }); anyOk = true; console.log(`  posted ${e.type} ${e.fips} -> ${p.name} ${res.uri || res.id || ""}`); }
      catch (err) { console.error(`  ::warning:: ${p.name} publish failed for ${e.type} ${e.fips}: ${err.message}`); }
    }
    if (anyOk) { liveState = commitPost(liveState, e, now); posted++; }
  }
  writeFileSync(STATE_PATH, JSON.stringify(liveState)); // persist latches + commits
  console.log(`poster: published ${posted}/${selected.length} across ${platforms.length} platform(s); state written to ${STATE_PATH}`);
})().catch((e) => { console.error("poster FAILED (non-fatal to the collector):", e.message); process.exit(0); });
