# Admin portal (admin.outageatlas.com)

An authenticated operator console with **two jobs**:

1. **Analytics** — privacy-preserving, cookieless visitor stats for the public site.
2. **Settings** — runtime-editable monetization + site config (ad provider, affiliate links, feature
   flags, announcement banner) that go live **without a code deploy**.

It runs on the **same Cloudflare Pages project** as the public site, exposed on the `admin.` subdomain
and protected by **Cloudflare Access** (Zero Trust). The admin API *also* verifies the Access JWT itself,
so it's safe even if reached directly.

```
Browser ──▶ admin.outageatlas.com  ──(Cloudflare Access: Google/GitHub/OTP)──▶  admin/index.html (SPA)
                                                                                    │
                                        /admin/api/*  (functions/admin/api/[[route]].js → workers/admin.mjs)
                                                                                    │  verifies Access JWT
                                                                                    ▼
public page ──▶ /api/track (beacon)   ┐                                        Cloudflare D1
public page ──▶ /api/config (read)    ┘────────────────────────────────────▶  (ANALYTICS_DB)
```

## Data model (Cloudflare D1, binding `ANALYTICS_DB`)

- **`events`** — one row per visit event. **PII-free by construction:** no IP, no cookie, no
  user-agent, no full referrer. Columns: `ts, day, type, path, ref(host only), country(2-letter),
  device(bucket), meta(small JSON), vid`.
  - `vid` is a **daily-rotating, one-way** token: `SHA-256(ip + ua + day + VID_SALT)` truncated. It lets
    us count **unique visitors per day** without ever identifying anyone or tracking across days/sites.
    Because the day is inside the hash, the same person on two days is two different `vid`s — this is the
    privacy guarantee, and it's unit-tested (`scripts/test_admin.mjs`).
  - Retention: rows older than **90 days** are pruned opportunistically on write (no cron needed).
- **`settings`** — a single JSON blob (`k='site'`) holding the editable config. Every write is run
  through an **allowlist sanitizer** (`sanitizeSettings`) so the blob can never carry arbitrary keys,
  non-https links, or an unknown ad provider into the public page.

The schema is created lazily on first use (`ensureSchema`), so there's no migration step.

## What "privacy-preserving" means here

The public page fires a cookieless beacon (`navigator.sendBeacon('/api/track', …)`) on pageview,
search, deep-view, and alert-signup. It sends **no identifiers**. The server derives everything
(country/device from Cloudflare headers, the anonymous daily `vid`) and stores only aggregates-friendly,
non-personal columns. No consent banner is required for this model, and the site keeps no advertising or
cross-site trackers **unless an operator turns on display ads** (see below).

## One-time operator setup (Cloudflare dashboard — an agent can't toggle these)

1. **Create the D1 database + binding.**
   - Cloudflare dashboard → left sidebar **Storage & databases → D1** → *Create database*
     (e.g. `outage-atlas-analytics`). Or CLI: `npx wrangler d1 create outage-atlas-analytics`.
   - Pages project → **Settings** → the **Bindings** section ("Define the set of resources available to
     your Pages Functions") → **+ Add** → **D1 database** → Variable name **`ANALYTICS_DB`** → the
     database above. (Dashboard note: there is no separate "Functions" page anymore — D1/KV live under
     **Bindings**; the KV `SUBS_KV` binding lives here too. No manual schema step — it self-creates.)
2. **Add the admin subdomain.**
   - Pages project → **Custom domains** → *Set up a custom domain* → `admin.outageatlas.com`.
     (Same project as `outageatlas.com`; the middleware routes `/` there to the portal.)
3. **Protect it with Cloudflare Access.**
   - Zero Trust dashboard → **Access → Applications → Add** → *Self-hosted*.
     Application domain: `admin.outageatlas.com` (all paths).
   - Add a **policy**: Action *Allow*, include your email / a Google/GitHub group.
   - Copy the application's **Application Audience (AUD)** tag and your **team domain**
     (`<team>.cloudflareaccess.com`).
4. **Set env vars** (Pages → Settings → **Variables and secrets**, Production):
   - `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag from step 3
   - `ACCESS_EMAILS` *(optional)* = comma-separated allowlist, belt-and-braces on top of the Access policy
   - `VID_SALT` *(recommended)* = a long random string (rotates → resets the anonymous token space)
5. **Deploy** (merge/push). Visit `https://admin.outageatlas.com/` → Access login → portal.

Until steps 1–4 are done: `/api/track` and `/api/config` **degrade gracefully** (accept-and-drop / serve
defaults), and the admin API returns `503 analytics DB not configured` or `403 access not configured`.
Nothing breaks on the public site.

## Editable settings (Settings tab)

| Group | Fields | Effect on the public site |
|---|---|---|
| **Display ads** | provider (`none`/`adsense`), client id, slot, enabled | Injects the AdSense unit into `#ads-slot` (below the fold, never gating outage info). `none` = zero third-party scripts. |
| **Affiliates** | EcoFlow URL, Jackery URL, lead endpoint | Merged into `window.OUTAGE_CONFIG` → used by `web/leadgen.mjs`. **https-only**; anything else is dropped. |
| **Feature flags** | leadgen, alerts widget, deep view | Hides/shows those surfaces live. |
| **Announcement banner** | enabled, text, level (info/warn/alert), https link | Renders a site-wide bar at the top of the page. |

Changes are live within ~60s (the `/api/config` response is edge-cached for 60s).

### ⚠️ Enabling display ads is a privacy/security tradeoff

The public page's CSP already allowlists Google's ad origins (`pagead2.googlesyndication.com`,
`googleads.g.doubleclick.net`, `tpc.googlesyndication.com`) so ads *can* be turned on from the portal
with no deploy. **But** turning AdSense on loads Google's ad scripts, which **do** track users for
advertising. If you enable ads you should:
- add a short **privacy policy** and (for EU/UK traffic) a **consent mechanism**, and
- reconsider the "no trackers" framing in the lead-gen copy.
With provider = **None** (the default) the site loads **no** third-party scripts and the CSP entries sit
unused.

## Files

```
admin/index.html                    the portal SPA (analytics dashboard + settings editor)
functions/_middleware.js            host routing (admin.* → portal; hide /admin* on the public host)
functions/admin/api/[[route]].js    admin API (Access-gated) → workers/admin.mjs
functions/api/track.js              public beacon        → workers/track.mjs
functions/api/config.js             public runtime config→ workers/config.mjs
workers/admin.mjs                   stats + settings handlers (requireAdmin)
workers/track.mjs                   cookieless event ingest
workers/config.mjs                  public settings read
workers/lib/db.mjs                  D1 layer + PURE helpers (hashVid, sanitizeSettings, stats shaping)
workers/lib/access.mjs              Cloudflare Access JWT verification
scripts/test_admin.mjs             unit tests (privacy token, settings allowlist, JWT claims) — in the PR gate
```

## Guardrails honored

- **No PII** stored anywhere (guardrail): the beacon/ingest path never persists an IP, UA, cookie, or
  full referrer.
- **Untrusted input:** every settings write is allowlisted + https-validated server-side; the ad client
  id is character-stripped.
- **Fail closed:** the admin API refuses to run without a verified Access JWT and configured `ACCESS_*`.
