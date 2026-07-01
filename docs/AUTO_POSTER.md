# Auto-poster — platform abstraction notes (Phase 2)

Notes for the Phase 2 acquisition engine (handoff v2 §2). The **multi-platform publish layer** (§2.6)
plan is below; the **detection/throttle core is now built** (see "Implementation" at the bottom).

## Implementation (shipped)

All under `poster/`, dependency-free + unit/replay-tested (`scripts/test_poster.mjs`, in the PR gate):

| File | Role |
|---|---|
| `poster/detect.mjs` | PURE `detectEvents` / `selectToPost` / `commitPost` — onset/escalation/restored/rollup, latch, per-area interval, global cap, dedup ledger, quiet hours. No IO/clock. |
| `poster/config.mjs` | Every threshold, env-overridable (`POSTER_ABS_FLOOR`, `POSTER_GLOBAL_CAP`, …). |
| `poster/templates.mjs` | PURE post copy (§2.4), ≤300 graphemes, derived `#<st>wx` hashtag. |
| `poster/facets.mjs` | PURE Bluesky rich-text facets (byte-range links + hashtags) — hand-rolled to stay dependency-free. |
| `poster/platforms/bluesky.mjs` | Bluesky XRPC client behind `publish(text, link)` (createSession + createRecord + external embed). |
| `poster/post.mjs` | Orchestrator (only IO/clock/network): load snapshot + state → detect → select → render → publish → persist `data/poster_state.json`. |

**Runs** as the `Auto-post outage events` step in `collect-baseline.yml`, after the snapshot is written
and before publish (so `poster_state.json` is committed to `tracker-data`).

### Going live (operator)
1. Create a Bluesky bot account + an **App Password** (Settings → App Passwords).
2. Repo → Settings → Secrets and variables → Actions: add secrets `BLUESKY_HANDLE`,
   `BLUESKY_APP_PASSWORD`; add variable `POSTER_ENABLED=1` (and optionally `POSTER_URL_BASE`,
   `POSTER_TZ`, or `POSTER_DRY_RUN=1` to force a rehearsal). Put "unofficial / not affiliated" in the
   **bot bio** to save post characters.
3. Until `POSTER_ENABLED=1` **and** both secrets exist, the step runs **dry-run** (logs would-be posts,
   writes nothing). Kill switch: set `POSTER_ENABLED` to anything but `1`.

### Known data limitation (from the Phase-1 finding)
The onset **percentage floor** (§2.2, "≥2% of the area's customers") needs a per-county customer
denominator. **ODIN carries none**, so the poster applies the **absolute floor only** unless a snapshot
county exposes `served` (deep feeds do). A future task can bundle a FIPS→customers/population table to
restore the % gate; the code already uses `county.served` when present.

## Phase 3 — email capture + subscriber alerts (shipped)

The owned-list asset. Reuses the SAME detection as the poster so an onset that posts also emails the
people watching that county.

| File | Role |
|---|---|
| `index.html` (`#alerts` panel) | "Alert me when {area} loses power" — email + honeypot, submits `{email, zip, fips}` to `/api/subscribe`. Appears once a location resolves; `fips` comes from the existing geo pipeline so matching is a pure FIPS join later. |
| `workers/subscribe.mjs` | Serverless intake: validates, honeypot, optional KV rate-limit, hands off to the email provider with **double opt-in** (provider owns confirmation + unsubscribe → CAN-SPAM). Stores nothing here (no PII in the repo). |
| `poster/notify.mjs` | PURE `matchSubscribers(areaEvents, subs)` (FIPS join) + `renderAlert` + env-gated `deliverAlerts` (DRY-RUN by default). Wired into `poster/post.mjs`, independent of the social gate. Alerts on onset + restored by default (`NOTIFY_TYPES`). |

### Going live (operator)
1. Pick a provider (Buttondown recommended — native double opt-in). Enable double opt-in on the account.
2. Deploy `workers/subscribe.mjs` at **`https://<site>/api/subscribe`** (same-origin keeps the page
   CSP at `connect-src 'self'`). Set worker env `EMAIL_PROVIDER=buttondown`, `EMAIL_API_KEY=…`
   (+ optional `SUBS_KV` binding for rate-limiting, `ALLOW_ORIGIN`).
3. To send outage alerts (not just collect the list): set collector env `NOTIFY_ENABLED=1`,
   `EMAIL_PROVIDER`, `EMAIL_API_KEY`, and `SUBSCRIBERS_URL` (a JSON endpoint returning
   `[{email,fips}]`). Until then the alerts step DRY-RUNs. **SMS is deferred** (TCPA/10DLC) per the handoff.

## Platform-abstraction plan (§2.6)

## The interface (§2.6)

```
detect_events(prev_state, snapshot) -> [Event]      # county-grain onset/escalation/restored/rollup
select_to_post(events, state)       -> [Post]        # latch, per-area interval, global cap, dedup
for platform in enabled: platform.publish(text, link, image)
```

Every platform is a client behind ONE `publish(text, link, image)` call. Detection/throttle never
know which platform is enabled. Ship **Bluesky only first**, then Mastodon; X and Threads drop in
without touching detection.

## Platform matrix

| Platform | Priority | Cost | Auth | Publish flow | Rate limit vs our throttle | Notes |
|---|---|---|---|---|---|---|
| **Bluesky** | 1 (first) | Free | App Password → `createSession` (accessJwt) | `com.atproto.repo.createRecord` | thousands/day — ours binds | Open AT-Proto, bot-tolerant. **Facets gotcha:** links/#tags need byte-range facets — use `@atproto/api` `RichText.detectFacets`, don't hand-roll. |
| **Mastodon** | 2 (next) | Free | Bearer token (app token) | `POST /api/v1/statuses` | generous — ours binds | Simplest of all — auto-linkifies, single call. |
| **X (Twitter)** | 3 | **Paid** API | OAuth 2.0 | `POST /2/tweets` | tight on cheap tiers | Deprioritized in the handoff purely on cost. |
| **Threads (Meta)** | 4 | Free | OAuth via Meta app; Threads user token (short→60-day long-lived, refreshable); scopes `threads_basic` + `threads_content_publish` (some scopes need **App Review**) | Two-step on `graph.threads.net`: `POST /me/threads` (create container) → `POST /me/threads_publish` | ~250 posts + ~1,000 replies /24h per user — ours binds | Official API, GA since 2024-06. Free + high reach, but heavier onboarding (App Review) and stricter platform policy than Bluesky/Mastodon. Two-call flow mirrors Bluesky's shape. **Verify current scopes/limits at developers.facebook.com/docs/threads before building — Meta's surface drifts.** |

## Client contract (keep platform quirks inside each client)

Each client owns: auth/token refresh, character-limit trimming (Bluesky ≤300 graphemes; others vary),
link/hashtag formatting (Bluesky facets vs Mastodon/Threads auto-linkify), and image/link-card embeds
(Bluesky `uploadBlob`→`embed`; Threads container media; Mastodon media attach). `publish()` returns
success/failure + the post id (for the dedup ledger in `poster_state.json`).

## Suggested build order

1. Bluesky client + `detect_events` + dry-run replay test (handoff §2.7) — **no live posting until the
   replay test shows a major storm → ~3–6 posts, not 80.**
2. Mastodon client (smallest surface — good second proof of the abstraction).
3. Threads client (free, high reach; do the Meta App Review in parallel since it's the long pole).
4. X client only if the paid tier is justified by measured referral traffic.

## Secrets (all via GitHub Secrets / env — never committed)

`BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD`; `MASTODON_INSTANCE` + `MASTODON_TOKEN`;
`THREADS_TOKEN` (+ app id/secret for refresh); `X_*` if enabled. Plus a global `POSTER_ENABLED`
kill switch and `POSTER_DRY_RUN` flag (§2.7).
