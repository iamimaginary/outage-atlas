# Amplifiers — share cards + embeddable widget (Phase 5)

Two ways a storm's reach compounds: richer link unfurls, and a live widget other sites host for you.

## Per-area OG cards

`scripts/gen_og_cards.mjs` renders a 1200×630 PNG per county to `og/<st>/<slug>.png` (pure Node —
`scripts/lib/png.mjs` + a 5×7 bitmap font). Each area page's `og:image` points at its card, so shared/
auto-posted links unfurl with the **area name** on the card. Evergreen (identity-based) → generated with
the area pages, no serverless renderer and no per-collect churn. Site-wide fallback: `og/og-default.png`.

- Run: `node scripts/gen_og_cards.mjs` (same county source as `gen_area_pages.mjs`; see docs/SEO.md).
- The audit (`scripts/audit_seo.mjs`, in the gate) fails if any page's `og:image` file is missing.
- Bluesky/Twitter scrape the page OG automatically, so the auto-poster's link card already shows the
  per-area image. (Optional upgrade: upload the PNG as a native `app.bsky.embed.images` blob for a bit
  more engagement — see `poster/platforms/bluesky.mjs`.)

## Embeddable live widget

One query-driven file — `embed/index.html` — serves **any** area, so a TV/weather/news site embeds it
once and every storm updates hands-off (auto-refresh every 5 min).

**Iframe (simplest):**
```html
<iframe src="https://outageatlas.com/embed/?fips=39035&name=Cuyahoga,%20OH"
        width="320" height="160" style="border:0" title="Live outage status"></iframe>
```
Params: `fips` (5-digit county FIPS, required), `name` (label), `theme=dark|light`.

**Script loader (`embed.js`)** — drop a div + one script, style via `data-*`:
```html
<div class="outage-atlas-embed" data-fips="39035" data-name="Cuyahoga, OH" data-theme="light"></div>
<script src="https://outageatlas.com/embed.js" async></script>
```

Both pull live numbers from the same `tracker-data` snapshot as the app, link back to the area page,
and carry the "unofficial" note. One meteorologist embedding it exposes you to their whole audience.
