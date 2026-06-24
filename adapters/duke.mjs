// Duke Energy adapter. Duke runs its OWN Apigee REST API (NOT Kübra, NOT poweroutage), CORS-locked to
// its outage-map origin and behind app-level Basic auth whose credentials are embedded in the page JS
// (and rotate). The fetch + auth-scraping + PII-stripping live in the collector (server-side); THIS
// module is the pure part: raw { summary, counties } for one jurisdiction -> canonical model.
//
// Jurisdictions = operating companies: DEC (Carolinas, NC/SC), DEF (Florida), DEI (Indiana),
// DEM (Ohio & Kentucky). NOTE: DEP (Progress) returns the SAME merged Carolinas dataset as DEC — only
// one of them is wired (duke-carolinas = DEC) to avoid double-counting.
//
// Field semantics mirror the app's own county parser:
//   county served = customersServedOverride ?? customersServed
//   county out    = customersAffectedOverride ?? areaOfInterestSummary.maxCustomersAffected ?? 0
//   county etr    = etrOverride ?? areaOfInterestSummary.latestRestorationDate ?? null
// summary.totalCustomersAffected reconciles with the sum of county out (verified in the spike).
// The summary carries NO served total, so official.served is summed from the counties.
// serviceAreas[] is a static/empty sub-level that also carries employee-email PII — the collector
// strips it before this parser runs, so subs are intentionally left empty (county-grain only).

const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const sane = (val, served) => { const o = Math.max(0, num(val)); return served > 0 ? Math.min(o, served) : o; };

// raw = { summary: <jurisdictions/{JUR} JSON>, counties: <counties?jurisdiction={JUR} JSON> }
export function parseDuke(raw) {
  const sd = raw && raw.summary && raw.summary.data;
  const rows = raw && raw.counties && Array.isArray(raw.counties.data) ? raw.counties.data : null;
  if (!sd || !rows) throw new Error("duke: missing summary.data or counties.data");
  const areas = rows.map((c) => {
    const served = num(c.customersServedOverride != null ? c.customersServedOverride : c.customersServed);
    const s = c.areaOfInterestSummary || null;
    const rawOut = c.customersAffectedOverride != null ? c.customersAffectedOverride : (s ? s.maxCustomersAffected : 0);
    const etr = c.etrOverride || (s && s.latestRestorationDate) || null;
    return {
      name: c.countyName || c.areaOfInterestName || "(unknown)",
      out: sane(rawOut, served),
      served,
      etr: typeof etr === "string" ? etr : null,
      loc: null, // county rows carry no lat/lon (markers live on a separate endpoint)
      subs: [],  // serviceAreas[] is static/empty + PII-bearing; not a reliable sub-breakdown
    };
  });
  const official = {
    out: num(sd.totalCustomersAffected),
    served: areas.reduce((a, x) => a + x.served, 0),
    nOut: num(sd.activeOutages),
  };
  return { official, areas };
}
