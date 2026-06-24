# spikes/ — Phase −1 validated-assumption evidence

Raw API captures from the read-only spike that de-risked the architecture **before** any code.
These are **not** golden-test fixtures (they're raw upstream responses, not `{raw, expected}`); they
document what was validated and seed the real golden fixtures built in later phases.

| Assumption | Verdict | Evidence | Notes |
|---|---|---|---|
| ODIN is a free, no-key, national, county-grain feed | ✅ GOOD | `odin/odin-records-sample.json` | 50 records; CORS `*`; on a calm day 35 states / 82 utilities active; FIPS in `communitydescriptor`, out in `metersaffected`, `geom` polygons |
| HIFLD resolves lat/lon → serving utility(ies) incl. overlaps | ✅ GOOD | `hifld/cleveland-overlap.json` | Cleveland point → CITY OF CLEVELAND (municipal) + CLEVELAND ELECTRIC ILLUM CO (IOU); 2931 territories; CORS `*` |
| The NEO Kübra parser generalizes to other utilities | ✅ with refinement | `kubra/dominion-report.json` | Parser runs + correct `official` (1979/2.82M), but reads only `fd.areas[0]` → undercounts Dominion's 7 regions (summed 274). Reconciliation catches it. Generalize in Phase 5. |

Endpoints (verified reachable through the agent network policy):
- ODIN: `https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records`
- HIFLD: `https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query`
  (NASA NCCS mirror `maps.nccs.nasa.gov` is **blocked** by policy — use this arcgis.com mirror)
- Kübra (Dominion, for the multi-state test): instance `9c691bb6-767e-4532-b00e-286ac9adc223`, view `38b5394c-8bca-4dfd-ac59-b321615446bd`
- All of ODIN / NWS / HIFLD / kubra.io serve `access-control-allow-origin: *`.
