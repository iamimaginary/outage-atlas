// Adapter registry — the single source of truth mapping an adapter id to its pure parser module.
// Generalizes NEO's hardcoded ADAPTERS map (it lived inside test_adapters.mjs) so the collector,
// the golden-test runner, and the config validator all resolve adapters the same way.
//
// To add a vendor: write adapters/<vendor>.mjs (pure raw->canonical), import it here, add one entry.
// `canonical: true` means the parser's output must also pass validateCanonical (the schema gate).
// `defaultFn` is the parser the golden runner / collector call unless a fixture overrides it via "fn".
import * as kubra from "./kubra.mjs";
import * as odin from "./odin.mjs";
import * as duke from "./duke.mjs";
import * as pge from "./pge.mjs";
import * as fpl from "./fpl.mjs";
import * as gvea from "./gvea.mjs";
import * as chugach from "./chugach.mjs";
import * as kiuc from "./kiuc.mjs";
import * as heco from "./heco.mjs";
import * as arcgis from "./arcgis.mjs";

export const ADAPTERS = {
  kubra: { mod: kubra, defaultFn: "parseKubraReport", canonical: true },
  // Duke Energy: own Apigee API (Basic-auth creds scraped at runtime; CORS-locked -> server-side only).
  duke: { mod: duke, defaultFn: "parseDuke", canonical: true },
  // PG&E: open Esri ArcGIS incident points grouped by city (feed omits served -> floored / config total).
  pge: { mod: pge, defaultFn: "parsePge", canonical: true },
  // FPL (Florida): plain county-total JSON, two regions merged (peninsula + panhandle); has served.
  fpl: { mod: fpl, defaultFn: "parseFpl", canonical: true },
  // Alaska (ODIN has zero AK coverage -> deep feeds are the ONLY source there):
  gvea: { mod: gvea, defaultFn: "parseGvea", canonical: true },     // Golden Valley Electric (Fairbanks)
  chugach: { mod: chugach, defaultFn: "parseChugach", canonical: true }, // Chugach Electric (Anchorage)
  // Hawaii (ODIN has zero HI coverage too): KIUC = Kauai (open). HECO/MECO/HELCO (95% of HI) are
  // auth-gated + origin-locked -> need HECO-issued credentials + a serverless proxy (Phase 5 / escalate).
  kiuc: { mod: kiuc, defaultFn: "parseKiuc", canonical: true },
  // HECO (Hawaiian Electric, ~95% of HI): SCAFFOLD — config ships disabled; auth-gated + origin-locked,
  // enabled only once an operator supplies HECO_ACCESS_KEY (workers/heco-proxy.mjs does the handshake).
  heco: { mod: heco, defaultFn: "parseHeco", canonical: true },
  // Generic Esri ArcGIS (config-driven field mapping) — SCE, Entergy, and other Esri-backed utilities.
  arcgis: { mod: arcgis, defaultFn: "parseArcgis", canonical: true },
  // ODIN is the national baseline; its output is an OUT-COUNT aggregate (no `served`), so it is NOT
  // the per-utility canonical shape — validated by check_baseline.mjs, not validateCanonical.
  odin: { mod: odin, defaultFn: "parseOdinRecords", canonical: false }
};

export const adapterIds = () => Object.keys(ADAPTERS);
export const getAdapter = (id) => ADAPTERS[id] || null;
