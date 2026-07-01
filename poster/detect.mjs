// Auto-poster core (handoff §2.2–§2.3) — PURE and unit-tested (scripts/test_poster.mjs). Never touches
// the network, the clock, or the filesystem: the orchestrator (post.mjs) injects `now` and does all IO.
// Split into three pure steps so behavior is fully replayable:
//   detectEvents(prevState, snapshot, now) -> { events, state }   // diff snapshot vs state; latch reality
//   selectToPost(events, state, now)       -> selected[]           // throttle / cap / dedup / quiet-hours
//   commitPost(state, event, now)          -> state                // record a post that actually went out
//
// State shape (persisted as data/poster_state.json on tracker-data, so it survives across runs):
//   { "<fips>": { event_id, phase:"ongoing"|"resolved", peak, first_seen, last_seen, last_out,
//                 clear_streak, last_posted_band, last_post_at },
//     "_global": { recent_post_times:[ms,...], posted_keys:[key,...] } }
import { CONFIG } from "./config.mjs";

const RESOLVED_TTL = 24 * 3600_000; // prune resolved areas after a day so state can't grow unbounded

const bandOf = (out, bands) => { let b = 0; for (const v of bands) if (out >= v) b = v; return b; };
const denomOf = (c) => (typeof c.served === "number" && c.served > 0 ? c.served : null);
const pctOf = (c) => { const d = denomOf(c); return d ? c.out / d : null; };
const areaName = (c) => `${c.county || c.name || c.fips}${c.county && /county|parish|borough/i.test(c.county) ? "" : ""}${c.state ? `, ${c.state}` : ""}`;
export const postKey = (e) => `${e.fips}|${e.event_id}|${e.type}|${e.band || 0}`;

// significant enough to open an event: absolute floor AND (if a denominator exists) the % floor.
function significant(c, cfg) {
  if (c.out < cfg.ABS_FLOOR) return false;
  const pct = pctOf(c);
  return pct == null ? true : pct >= cfg.PCT_FLOOR; // ODIN has no denom -> absolute-only (documented)
}

export function detectEvents(prevState, snapshot, now, cfg = CONFIG) {
  const state = structuredClone(prevState || {});
  const globalKeep = state._global || { recent_post_times: [], posted_keys: [] };
  delete state._global;

  const counties = snapshot.counties || {};
  const raw = [];

  // union of currently-reported counties and areas we're already tracking (so recoveries — which DROP
  // out of ODIN entirely — are detected as out==0).
  const ids = new Set([...Object.keys(counties), ...Object.keys(state)]);

  for (const fips of ids) {
    const c = counties[fips] || { fips, out: 0 };
    const out = Math.max(0, c.out || 0);
    let a = state[fips];

    if (!a || a.phase === "resolved") {
      if (out > 0 && significant(c, cfg)) {
        a = state[fips] = { event_id: `${fips}:${now}`, phase: "ongoing", peak: out, first_seen: now, last_seen: now, last_out: out, clear_streak: 0, last_posted_band: 0, last_post_at: 0 };
        raw.push({ type: "onset", fips, name: areaName(c), state: c.state || "", out, band: bandOf(out, cfg.BANDS), pct: pctOf(c), atTs: now, event_id: a.event_id });
      } else if (a && a.phase === "resolved" && now - (a.last_seen || 0) > RESOLVED_TTL) {
        delete state[fips]; // prune old resolved areas
      }
      continue;
    }

    // active (ongoing) event
    a.peak = Math.max(a.peak, out);
    const clearThreshold = Math.max(cfg.ABS_FLOOR, a.peak * cfg.CLEAR_FRAC);
    if (out < clearThreshold) {
      a.clear_streak = (a.clear_streak || 0) + 1;
      if (a.clear_streak >= cfg.CLEAR_RUNS) {
        a.phase = "resolved";
        raw.push({ type: "restored", fips, name: areaName(c), state: c.state || "", out, peak: a.peak, atTs: now, event_id: a.event_id });
      }
    } else {
      a.clear_streak = 0;
      const b = bandOf(out, cfg.BANDS);
      if (b > a.last_posted_band) {
        raw.push({ type: "escalation", fips, name: areaName(c), state: c.state || "", out, band: b, delta: Math.max(0, out - (a.last_out || 0)), sinceTs: a.last_seen || a.first_seen, pct: pctOf(c), atTs: now, event_id: a.event_id });
      }
    }
    a.last_out = out;
    a.last_seen = now;
  }

  // regional roll-up: many onsets in one run => ONE aggregate, suppress the singles (state stays latched).
  let events = raw;
  const onsets = raw.filter((e) => e.type === "onset");
  if (onsets.length >= cfg.ROLLUP_K) {
    const states = new Set(onsets.map((e) => e.state).filter(Boolean));
    events = raw.filter((e) => e.type !== "onset");
    events.push({ type: "rollup", fips: "_rollup", name: "multiple counties", state: states.size === 1 ? [...states][0] : "", sumOut: onsets.reduce((s, e) => s + e.out, 0), count: onsets.length, atTs: now, event_id: `rollup:${now}` });
  }

  state._global = globalKeep;
  return { events, state };
}

const inQuietHours = (hour, cfg) => (cfg.QUIET_START > cfg.QUIET_END ? hour >= cfg.QUIET_START || hour < cfg.QUIET_END : hour >= cfg.QUIET_START && hour < cfg.QUIET_END);
const isMinor = (e) => e.type === "escalation" && (e.band || 0) < 50000;

// Order + filter events into what should actually post this run. Pure: returns the selected events;
// does NOT mutate state (commitPost does that after a post succeeds). `hour` = local hour for quiet-hours.
export function selectToPost(events, state, now, hour, cfg = CONFIG) {
  const g = state._global || { recent_post_times: [], posted_keys: [] };
  const postedKeys = new Set(g.posted_keys || []);
  const recent = (g.recent_post_times || []).filter((t) => now - t < 3600_000);

  let cands = events.filter((e) => {
    if (postedKeys.has(postKey(e))) return false;                 // idempotency / never post a key twice
    const a = state[e.fips];
    if (e.type !== "restored" && e.fips !== "_rollup" && a && a.last_post_at && now - a.last_post_at < cfg.PER_AREA_MIN_MS) return false; // per-area interval
    if (inQuietHours(hour, cfg) && isMinor(e)) return false;       // quiet hours: minors only
    return true;
  });

  // rank by customers-out × (pct if known) — biggest, most-relevant first — then apply the global cap.
  const score = (e) => (e.sumOut || e.out || 0) * (e.pct ? 1 + e.pct : 1);
  cands.sort((a, b) => score(b) - score(a));
  const room = Math.max(0, cfg.GLOBAL_CAP_PER_HR - recent.length);
  return cands.slice(0, room);
}

// Record that `event` was posted: advance the area's throttle state + the global ledgers. Pure.
export function commitPost(state, event, now, cfg = CONFIG) {
  const s = structuredClone(state);
  s._global = s._global || { recent_post_times: [], posted_keys: [] };
  const a = s[event.fips];
  if (a) {
    a.last_post_at = now;
    if (event.type === "onset" || event.type === "escalation") a.last_posted_band = event.band || a.last_posted_band;
  }
  s._global.recent_post_times = [...(s._global.recent_post_times || []).filter((t) => now - t < 3600_000), now];
  s._global.posted_keys = [...(s._global.posted_keys || []), postKey(event)].slice(-cfg.POSTED_KEYS_CAP);
  return s;
}
