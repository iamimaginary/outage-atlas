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

export const ADAPTERS = {
  kubra: { mod: kubra, defaultFn: "parseKubraReport", canonical: true },
  // Duke Energy: own Apigee API (Basic-auth creds scraped at runtime; CORS-locked -> server-side only).
  duke: { mod: duke, defaultFn: "parseDuke", canonical: true },
  // PG&E: open Esri ArcGIS incident points grouped by city (feed omits served -> floored / config total).
  pge: { mod: pge, defaultFn: "parsePge", canonical: true },
  // ODIN is the national baseline; its output is an OUT-COUNT aggregate (no `served`), so it is NOT
  // the per-utility canonical shape — validated by check_baseline.mjs, not validateCanonical.
  odin: { mod: odin, defaultFn: "parseOdinRecords", canonical: false }
};

export const adapterIds = () => Object.keys(ADAPTERS);
export const getAdapter = (id) => ADAPTERS[id] || null;
