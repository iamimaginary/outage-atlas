// Auto-poster tuning — every significance/throttle knob in one place (handoff §2.2–§2.3).
// Overridable via env so the operator can tune without a code change.
const n = (k, d) => (process.env[k] != null && process.env[k] !== "" ? Number(process.env[k]) : d);

export const CONFIG = {
  // significance (onset). Percentage floor only applies when a per-area customer denominator is
  // available (ODIN baseline has NONE — see docs/AUTO_POSTER-DATA note); otherwise absolute-only.
  ABS_FLOOR: n("POSTER_ABS_FLOOR", 1000),
  PCT_FLOOR: n("POSTER_PCT_FLOOR", 0.02),
  // escalation bands: post once as an ongoing event crosses each.
  BANDS: [1000, 5000, 10000, 25000, 50000, 100000, 250000],
  // restored: out has fallen below max(ABS_FLOOR, peak*CLEAR_FRAC) for CLEAR_RUNS consecutive runs.
  CLEAR_FRAC: n("POSTER_CLEAR_FRAC", 0.1),
  CLEAR_RUNS: n("POSTER_CLEAR_RUNS", 2),
  // regional roll-up: >= ROLLUP_K counties hitting onset in one run => one aggregate, suppress singles.
  ROLLUP_K: n("POSTER_ROLLUP_K", 5),
  // throttle
  PER_AREA_MIN_MS: n("POSTER_PER_AREA_MIN_H", 2) * 3600_000, // >=1 post / 2h per area (except all-clear)
  GLOBAL_CAP_PER_HR: n("POSTER_GLOBAL_CAP", 6),
  QUIET_START: n("POSTER_QUIET_START", 23), // suppress MINOR escalations in [23:00,06:00) UTC-local*
  QUIET_END: n("POSTER_QUIET_END", 6),      // (*orchestrator passes the hour; majors still post)
  POSTED_KEYS_CAP: 500, // bounded idempotency ledger
};
