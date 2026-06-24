// Adapter registry — the single source of truth mapping an adapter id to its pure parser module.
// Generalizes NEO's hardcoded ADAPTERS map (it lived inside test_adapters.mjs) so the collector,
// the golden-test runner, and the config validator all resolve adapters the same way.
//
// To add a vendor: write adapters/<vendor>.mjs (pure raw->canonical), import it here, add one entry.
// `canonical: true` means the parser's output must also pass validateCanonical (the schema gate).
// `defaultFn` is the parser the golden runner / collector call unless a fixture overrides it via "fn".
import * as kubra from "./kubra.mjs";

export const ADAPTERS = {
  kubra: { mod: kubra, defaultFn: "parseKubraReport", canonical: true }
  // odin:  added in Phase 1 (national baseline)
  // arcgis: added in Phase 5 (other vendors)
};

export const adapterIds = () => Object.keys(ADAPTERS);
export const getAdapter = (id) => ADAPTERS[id] || null;
