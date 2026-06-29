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
import * as ifactor from "./ifactor.mjs";
import * as pacificorp from "./pacificorp.mjs";
import * as wec from "./wec.mjs";
import * as aesOhio from "./aes-ohio.mjs";
import * as omap from "./omap.mjs";
import * as datacapable from "./datacapable.mjs";
import * as luma from "./luma.mjs";
import * as midamerican from "./midamerican.mjs";
import * as idahoPower from "./idaho-power.mjs";
import * as aesIndiana from "./aes-indiana.mjs";
import * as tep from "./tep.mjs";
import * as teco from "./teco.mjs";
import * as elPaso from "./el-paso.mjs";
import * as puget from "./puget.mjs";
import * as smud from "./smud.mjs";
import * as mlgw from "./mlgw.mjs";
import * as nwe from "./nwe.mjs";
import * as cleco from "./cleco.mjs";
import * as gmp from "./gmp.mjs";
import * as clarkPud from "./clark-pud.mjs";
import * as kub from "./kub.mjs";
import * as liberty from "./liberty.mjs";
import * as novec from "./novec.mjs";
import * as pge2 from "./pge-graphql.mjs";
import * as milsoft from "./milsoft.mjs";
import * as gridvu from "./gridvu.mjs";
import * as smartc from "./smartc.mjs";
import * as sienatech from "./sienatech.mjs";
import * as anaheim from "./anaheim.mjs";

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
  // Legacy Kübra "iFactor" Storm Center (static JSON: metadata -> data.json + report_*.json) — Con Ed, Eversource.
  ifactor: { mod: ifactor, defaultFn: "parseIfactor", canonical: true },
  // Bespoke self-hosted vendor feeds:
  pacificorp: { mod: pacificorp, defaultFn: "parsePacificorp", canonical: true }, // 6 state JSON files
  wec: { mod: wec, defaultFn: "parseWec", canonical: true },                       // We Energies + Wisconsin Public Service
  "aes-ohio": { mod: aesOhio, defaultFn: "parseAesOhio", canonical: true },        // Dayton P&L XML feed
  omap: { mod: omap, defaultFn: "parseOmap", canonical: true },                    // PPL "OMAP" — PPL Electric + RI Energy
  datacapable: { mod: datacapable, defaultFn: "parseDatacapable", canonical: true }, // Seattle City Light + Duquesne
  luma: { mod: luma, defaultFn: "parseLuma", canonical: true },                    // LUMA/PREPA (Puerto Rico)
  midamerican: { mod: midamerican, defaultFn: "parseMidamerican", canonical: true },
  "idaho-power": { mod: idahoPower, defaultFn: "parseIdahoPower", canonical: true },
  "aes-indiana": { mod: aesIndiana, defaultFn: "parseAesIndiana", canonical: true }, // IPL XML feed
  tep: { mod: tep, defaultFn: "parseTep", canonical: true },                        // Tucson Electric Power
  teco: { mod: teco, defaultFn: "parseTeco", canonical: true },                     // Tampa Electric (micustomer ES)
  "el-paso": { mod: elPaso, defaultFn: "parseElPaso", canonical: true },            // El Paso Electric (AES-GCM)
  puget: { mod: puget, defaultFn: "parsePuget", canonical: true },                  // Puget Sound Energy (Sitecore)
  smud: { mod: smud, defaultFn: "parseSmud", canonical: true },                     // Sacramento Municipal Utility District
  mlgw: { mod: mlgw, defaultFn: "parseMlgw", canonical: true },                     // Memphis Light, Gas & Water (GeoJSON)
  nwe: { mod: nwe, defaultFn: "parseNwe", canonical: true },                        // NorthWestern Energy (MT)
  cleco: { mod: cleco, defaultFn: "parseCleco", canonical: true },                  // CLECO (LA)
  gmp: { mod: gmp, defaultFn: "parseGmp", canonical: true },                        // Green Mountain Power (VT)
  "clark-pud": { mod: clarkPud, defaultFn: "parseClarkPud", canonical: true },      // Clark Public Utilities (WA, JSONP)
  kub: { mod: kub, defaultFn: "parseKub", canonical: true },                        // Knoxville Utilities Board
  liberty: { mod: liberty, defaultFn: "parseLiberty", canonical: true },            // Liberty/Empire (SmartCMobile)
  novec: { mod: novec, defaultFn: "parseNovec", canonical: true },                  // Northern Virginia EC (StormCenter XML)
  "pge-graphql": { mod: pge2, defaultFn: "parsePge2", canonical: true },            // Portland General Electric (GraphQL)
  milsoft: { mod: milsoft, defaultFn: "parseMilsoft", canonical: true },            // Milsoft Web Outage Viewer (co-op static JSON)
  gridvu: { mod: gridvu, defaultFn: "parseGridvu", canonical: true },               // ACS GridVu (Lubbock, Lansing)
  smartc: { mod: smartc, defaultFn: "parseSmartc", canonical: true },               // SmartC Mobile / SEDC (Madison G&E)
  sienatech: { mod: sienatech, defaultFn: "parseSienatech", canonical: true },      // Siena WebSurv (United Power)
  anaheim: { mod: anaheim, defaultFn: "parseAnaheim", canonical: true },            // Anaheim Public Utilities GeoJSON
  // ODIN is the national baseline; its output is an OUT-COUNT aggregate (no `served`), so it is NOT
  // the per-utility canonical shape — validated by check_baseline.mjs, not validateCanonical.
  odin: { mod: odin, defaultFn: "parseOdinRecords", canonical: false }
};

export const adapterIds = () => Object.keys(ADAPTERS);
export const getAdapter = (id) => ADAPTERS[id] || null;
