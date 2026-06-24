# outage-atlas

**A national, location-first US power-outage atlas.** Enter your location (ZIP, address, or "use my
location") and get the maximum available outage detail for *that* place — a free nationwide baseline
for every location, plus deep per-utility detail where available.

The nationwide sibling of the single-market [NE Ohio restoration tracker](https://github.com/iamimaginary/Restoration-tracker).
Built to run hands-off and be **maintained by Claude agents** behind audit gates — see [`CLAUDE.md`](./CLAUDE.md).

## How it works

- **Baseline (free, public-domain, no scraping):** [ODIN](https://odin.ornl.gov/) (DOE/ORNL)
  county-level outages + [NWS](https://api.weather.gov) weather alerts, pre-aggregated every ~15 min by
  a GitHub-Actions collector into a small sharded snapshot on the `tracker-data` branch.
- **Location → utility → detail:** geocode (Zippopotam/Census) → county (FCC Area API) → serving
  utility ([HIFLD](https://hifld-geoplatform.hub.arcgis.com/) territory polygons) → that utility's deep
  vendor feed (Kübra et al.) via utility-agnostic adapters.
- **Static-first:** a GitHub Pages page reads the baseline; deep feeds are fetched on demand. A
  serverless proxy is added only for CORS-blocked vendors.

## Data sources & licensing

| Source | Use | License |
|---|---|---|
| ODIN (DOE/ORNL) | national county-level outages | open / public |
| NWS api.weather.gov | weather-alert overlay | public domain |
| HIFLD Electric Retail Service Territories | location → serving utility | public domain |
| Kübra Storm Center | deep per-utility detail | per-utility public outage feeds |

poweroutage.us is **not** used — it is commercially licensed and prohibits scraped use; it can only be
enabled as a key-gated optional layer the operator licenses themselves.

## Status

Under active construction. See the build phases in [`CLAUDE.md`](./CLAUDE.md).

## Develop

```
npm test     # adapter golden tests + config validation
```