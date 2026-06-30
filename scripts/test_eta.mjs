// Unit tests for the recovery-ETA estimator (scripts/lib/eta.mjs) — the universal "every ZIP gets a
// recovery time" logic. Synthetic histories with explicit timestamps; asserts each trend class and the
// ETA math (incl. the gated deceleration). Pure, no network. Exits non-zero on any failure.
import { restorationRate, estimateRecovery, countyEta, etaConfidence } from "./lib/eta.mjs";

let failed = 0;
const ok = (c, m) => { if (c) console.log("✓ " + m); else { failed++; console.error("✗ " + m); } };
const H = 3600000;
const t0 = 1_700_000_000_000;
const ser = (...pairs) => pairs.map(([dtH, out]) => ({ t: t0 + dtH * H, out })); // hours-from-t0, out

// improving: 1000 -> 500 over 2.5h, peak 1000 -> rate 200/hr, f=0.5 -> decel 1 -> eta 2.5h
const imp = estimateRecovery(ser([0, 1000], [2.5, 500]), 500, 1000);
ok(imp.kind === "improving", `improving trend detected (got ${imp.kind})`);
ok(Math.abs(imp.perHour - 200) < 1, `rate ~200/hr (got ${imp.perHour})`);
ok(Math.abs(imp.etaHrs - 2.5) < 0.05, `eta ~2.5h (got ${imp.etaHrs})`);

// deceleration: big outage (peak 2000) deep into recovery -> eta stretched up to ~2x
const dec = estimateRecovery(ser([0, 400], [1, 200]), 200, 2000); // rate 200/hr, f=0.9 -> decel 1.8 -> 1.8h
ok(dec.kind === "improving" && Math.abs(dec.etaHrs - 1.8) < 0.05, `deceleration applied (eta ~1.8h, got ${dec.etaHrs})`);

// rising: 100 -> 300 over 1h -> rising 200/hr
const ris = estimateRecovery(ser([0, 100], [1, 300]), 300, 300);
ok(ris.kind === "rising" && Math.abs(ris.perHour - 200) < 1, `rising trend detected (got ${ris.kind} ${ris.perHour})`);

// holding: 1000 -> 999 over 1h -> change below max(5, 1% of out) -> holding
ok(estimateRecovery(ser([0, 1000], [1, 999]), 999, 1000).kind === "holding", "holding (sub-threshold change) detected");

// restored / collecting
ok(estimateRecovery(ser([0, 0]), 0, 100).kind === "restored", "restored when out is 0");
ok(estimateRecovery(ser([0, 50]), 50, 50).kind === "collecting", "collecting with a single reading");
ok(restorationRate([{ t: t0, out: 5 }]) === null, "restorationRate null with <2 points");

// countyEta wrapper: label present, etaHrs rounded
const ce = countyEta(ser([0, 1000], [2.5, 500]), 500, 1000);
ok(ce.kind === "improving" && /to restore/.test(ce.label) && ce.etaHrs === 2.5, `countyEta returns label + rounded eta (got "${ce.label}", ${ce.etaHrs})`);
ok(countyEta(ser([0, 0]), 0, 100).label === "power restored", "countyEta restored label");

// confidence scales with how much history backs the estimate: <4 thin, <12 moderate, >=12 good
ok(etaConfidence(ser([0, 1], [1, 2])) === "low", "etaConfidence low with 2 readings");
ok(etaConfidence(Array.from({ length: 6 }, (_, i) => ({ t: t0 + i * H, out: 100 }))) === "moderate", "etaConfidence moderate with 6 readings");
ok(etaConfidence(Array.from({ length: 14 }, (_, i) => ({ t: t0 + i * H, out: 100 }))) === "good", "etaConfidence good with 14 readings");
// countyEta tags an improving estimate with its confidence
ok(countyEta(ser([0, 1000], [2.5, 500]), 500, 1000).confidence === "low", "countyEta attaches confidence to an improving estimate");

console.log(`\n${failed ? failed + " FAILED" : "all eta tests passed"}`);
process.exit(failed ? 1 : 0);
