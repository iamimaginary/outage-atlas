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
| `poster/platforms/threads.mjs` | Meta Threads client behind the same `publish()` — two-step container→publish on `graph.threads.net` (auto-linkifies, no facets). |
| `poster/platforms/x.mjs` | X (Twitter) client — `POST /2/tweets` with dependency-free OAuth 1.0a signing; trims to 280 chars. Paid tier. |
| `poster/post.mjs` | Orchestrator (only IO/clock/network): load snapshot + state → detect → select → render → **publish to every platform whose creds are set** → persist `data/poster_state.json`. |

**Runs** as the `Auto-post outage events` step in `collect-baseline.yml`, after the snapshot is written
and before publish (so `poster_state.json` is committed to `tracker-data`).

### Going live (operator)
1. Create a Bluesky bot account + an **App Password** (Settings → App Passwords).
2. Repo → Settings → Secrets and variables → Actions: add secrets `BLUESKY_HANDLE`,
   `BLUESKY_APP_PASSWORD`; add variable `POSTER_ENABLED=1` (and optionally `POSTER_URL_BASE`,
   `POSTER_TZ`, or `POSTER_DRY_RUN=1` to force a rehearsal). Put "unofficial / not affiliated" in the
   **bot bio** to save post characters.
3. Until `POSTER_ENABLED=1` **and** at least one platform's creds exist, the step runs **dry-run** (logs
   would-be posts, writes nothing). Kill switch: set `POSTER_ENABLED` to anything but `1`.
4. **Threads (optional, also live):** add secrets `THREADS_USER_ID` + `THREADS_ACCESS_TOKEN` (from a Meta
   app with `threads_basic` + `threads_content_publish`).
5. **X / Twitter (optional, paid):** add secrets `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
   `X_ACCESS_SECRET` (a developer app with write access + user-context tokens for the bot account).
   Note the low free-tier write caps.

With `POSTER_ENABLED=1`, each selected post goes to **every** platform whose creds are set (Bluesky,
Threads, and/or X). An event is committed to the dedup ledger once at least one platform accepts it, so
one platform failing never blocks the others or loses the post.

### Known data limitation (from the Phase-1 finding)
The onset **percentage floor** (§2.2, "≥2% of the area's customers") needs a per-county customer
denominator. **ODIN carries none**, so the poster applies the **absolute floor only** unless a snapshot
county exposes `served` (deep feeds do). A future task can bundle a FIPS→customers/population table to
restore the % gate; the code already uses `county.served` when present.

## Phase 3 — Web Push alerts (shipped; replaced email)

Direct push notifications keyed to the user's county — no vendor, no cookies, no email provider.
Payload-less Web Push (VAPID): the push carries no body, so the only crypto is the VAPID ES256 JWT;
the service worker builds the notification text from the public baseline on receipt. Design + protocol
were verified by an adversarial multi-agent pass before implementation.

| File | Role |
|---|---|
| `web/push.mjs` | Client "Notify me" control: permission → `pushManager.subscribe({userVisibleOnly, applicationServerKey})` → stash `{fips,area,areaPath}` in IndexedDB → POST `{subscription, fips}` to `/api/push-subscribe`. iOS "Add to Home Screen" hint when unsupported. |
| `sw.js` (v4) | `push` handler (payload-less): reads IndexedDB prefs, fetches the baseline, infers **out>0 → "⚡ outage" / 0 → "✅ restored"**, `tag: outage-<fips>` so it updates in place + clears on resolve. `notificationclick` opens the area page. |
| `workers/push-subscribe.mjs` → `/api/push-subscribe` | Stores `{endpoint, fips}` in Cloudflare KV (private). Push-service origin allowlist, honeypot, per-IP rate limit. DELETE = unsubscribe. |
| `workers/push-subscribers.mjs` → `/api/push-subscribers` | Bearer-gated (`PUSH_READ_TOKEN`) read-only list for the collector (cursor-paginated) + DELETE prune. |
| `poster/webpush.mjs` | Pure `node:crypto` VAPID ES256 signer (`dsaEncoding:'ieee-p1363'` → raw 64-byte sig) + payload-less sender. Golden-tested (`scripts/test_webpush.mjs`). |
| `poster/notify.mjs` | PURE `matchSubscribers` (FIPS join) + env-gated `deliverPush` (DRY-RUN by default; prunes on 404/410). Alerts on onset + escalation + restored (`NOTIFY_TYPES`). |

### Going live (operator)
1. `node scripts/gen_vapid.mjs` → paste `VAPID_PUBLIC_KEY` into `config.js` (public) + a GH var; put
   `VAPID_PRIVATE_KEY` (PKCS8 PEM) in a **GitHub Actions secret**; set `VAPID_SUBJECT=https://outageatlas.com`.
2. Cloudflare Pages project: bind a **KV namespace** as `SUBS_KV`; add secret `PUSH_READ_TOKEN`.
3. GitHub Actions: add vars `PUSH_ENABLED=1`, `PUSH_SUBSCRIBERS_URL=https://outageatlas.com/api/push-subscribers`,
   `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; secrets `PUSH_READ_TOKEN`, `VAPID_PRIVATE_KEY`.
   Until `PUSH_ENABLED=1` + keys exist, the alerts step DRY-RUNs (logs, sends nothing).

**Caveats (verified):** iOS/iPadOS only delivers Web Push to a **home-screen-installed PWA** (Safari-tab
iOS users can't get it — the tradeoff vs email). Firefox payload-less delivery to live-verify on first
send. Subscriptions are per-device records in **private KV, never the repo**. **SMS remains deferred**
(TCPA/10DLC).

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
| **Bluesky** | 1 — **BUILT** | Free | App Password → `createSession` (accessJwt) | `com.atproto.repo.createRecord` | thousands/day — ours binds | Open AT-Proto, bot-tolerant. Byte-range facets hand-rolled (`poster/facets.mjs`) to stay dependency-free. |
| **Threads (Meta)** | 2 — **BUILT** | Free | Threads user token (short→60-day long-lived), scopes `threads_basic` + `threads_content_publish` (some need **App Review**) | Two-step on `graph.threads.net`: `{userId}/threads` (create container) → `{userId}/threads_publish` | ~250 posts + ~1,000 replies /24h per user — ours binds | `poster/platforms/threads.mjs`. Auto-linkifies (no facets). Free + high reach; heavier onboarding (App Review). **Verify current scopes/limits at developers.facebook.com/docs/threads — Meta's surface drifts.** |
| **X (Twitter)** | 3 — **BUILT** | **Paid** API | OAuth 1.0a (API key/secret + access token/secret) | `POST /2/tweets` | tight on cheap tiers — free write caps are very low | `poster/platforms/x.mjs`. Auto-linkifies; trims to 280. Highest `#wx`/breaking-local reach of the built set, but paid. On a paid tier consider raising `POSTER_GLOBAL_CAP`. |
| **Mastodon** | 4 (optional) | Free | Bearer token (app token) | `POST /api/v1/statuses` | generous — ours binds | Drop-in behind `publish()` if ever wanted; small audience for this vertical, so parked. |

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
