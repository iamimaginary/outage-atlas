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

  const { events, state } = detectEvents(prevState, snapshot, now);
  const selected = selectToPost(events, state, now, localHour(now));

  const enabled = process.env.POSTER_ENABLED === "1";
  const dryRun = !enabled || process.env.POSTER_DRY_RUN === "1" || !process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD;

  console.log(`poster: ${events.length} event(s) detected, ${selected.length} to post ${dryRun ? "(DRY-RUN — nothing published, no state written)" : "(LIVE)"}`);
  for (const e of events) console.log(`  · ${e.type} ${e.fips} ${e.name || ""} out=${e.out ?? e.sumOut ?? ""}${selected.includes(e) ? "  → POST" : "  (held)"}`);

  if (dryRun) {
    for (const e of selected) { const { text } = renderPost(enrich(e), { url: urlFor(e) }); console.log(`\n  WOULD POST (${[...text].length}c):\n  ${text}\n`); }
    return; // dry-run is fully side-effect-free
  }

  // LIVE: publish each selected post; commit only what actually went out (a failed post retries next run).
  const bsky = makeBluesky({ handle: process.env.BLUESKY_HANDLE, appPassword: process.env.BLUESKY_APP_PASSWORD });
  let liveState = state, posted = 0;
  for (const e of selected) {
    const { text, link } = renderPost(enrich(e), { url: urlFor(e) });
    try {
      const res = await bsky.publish({ text, link }, { createdAt: new Date(now).toISOString() });
      liveState = commitPost(liveState, e, now);
      posted++;
      console.log(`  posted ${e.type} ${e.fips} -> ${res.uri}`);
    } catch (err) {
      console.error(`  ::warning:: publish failed for ${e.type} ${e.fips}: ${err.message}`);
    }
  }
  writeFileSync(STATE_PATH, JSON.stringify(liveState)); // persist latches + commits
  console.log(`poster: published ${posted}/${selected.length}; state written to ${STATE_PATH}`);
})().catch((e) => { console.error("poster FAILED (non-fatal to the collector):", e.message); process.exit(0); });
