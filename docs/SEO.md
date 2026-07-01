# Programmatic SEO area pages (Phase 4)

People search "**[town] power outage**" in volume during storms. `scripts/gen_area_pages.mjs` builds a
static, indexable page per county — the evergreen acquisition floor.

## What it generates

- `/outage/<st>/<county-slug>` — per-county page: unique title/description/canonical/H1, a real static
  paragraph (sources, cadence, ZIP→county ETA), **live status hydrated client-side** from the
  tracker-data snapshot, the email capture form (Phase 3, `fips` baked in), cross-links, and the
  "unofficial / not affiliated" disclaimer.
- `/outage/<st>/` — per-state county index. `/outage/` — national state index.
- `sitemap.xml` — regenerated with every URL (owned by this script; don't hand-edit).

## Design: evergreen shell + client-side live data

Area **identity** (county/state) is stable, so pages are generated once and committed to the **code
branch** (GitHub Pages serves them). Live numbers are fetched client-side from
`raw.githubusercontent.com/.../tracker-data/national/baseline.json` — the same data plane as the app.
This is deliberate: the collector writes to the `tracker-data` branch and must **not** churn the Pages
branch every 15 min (see CLAUDE.md). Re-run the generator only when the **county set** changes.

## Run it

```
node scripts/gen_area_pages.mjs           # uses the county source below, writes outage/ + sitemap.xml
node scripts/audit_seo.mjs                # gate: unique titles/canonicals, sitemap sync (in npm test)
```

County source, first that exists:
1. `$AREA_SOURCE` — a JSON file (array `[{fips,county,state}]` or a baseline-shaped `{counties:{…}}`).
2. `data/national/baseline.json` — every county in the current snapshot (at collect time).
3. `scripts/data/seed-counties.json` — the committed seed (NE Ohio + major metros) that ships today.

**Full national set — SHIPPED.** `npm run gen:national` builds the whole country:
1. `scripts/gen_us_counties.mjs` fetches the Census county code file → `scripts/data/us-counties.json`
   (~3,221 counties; names normalized, independent cities keep " city" to avoid slug collisions).
2. `scripts/gen_og_cards.mjs` renders per-area OG cards for the **metros** (the seed list).
3. `gen_area_pages.mjs` (with `AREA_SOURCE=scripts/data/us-counties.json`) writes a page per county +
   state/national indexes + sitemap. Pages reference their per-area OG card **if it exists**, else the
   site-wide default — so the metro cards render richly and the long tail still unfurls.

The committed set is ~3,274 pages (every US county + DC + PR). Re-run `gen:national` when Census updates
the county list. `SITE_BASE` overrides the domain (default `https://outageatlas.com`). Per-state slug
collisions (e.g. VA "Fairfax" county vs "Fairfax city") are auto-disambiguated and kept in sync across
file path, canonical, sitemap, and cross-links.
