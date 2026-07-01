// Lead-gen classifier tests (Phase 6): the PURE variant selector that decides acute vs chronic vs none
// from an area's state. renderCTA touches the DOM, so it's exercised in-browser, not here. Exits non-zero.
import { classifyArea } from "../web/leadgen.mjs";

let fails = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); fails++; } };

console.log("classifyArea:");
ok(classifyArea({ out: 8000 }, ["Severe Thunderstorm Warning"]) === "acute", "out + active weather alert = acute (portable power)");
ok(classifyArea({ out: 8000 }, []) === "chronic", "out with NO weather alert = chronic (blue-sky reliability flag)");
ok(classifyArea({ out: 8000 }) === "chronic", "out with undefined alerts = chronic (no storm context)");
ok(classifyArea({ out: 0 }, []) === "none", "no outage, no grade = none (render nothing)");
ok(classifyArea(null, []) === "none", "no county data = none");
ok(classifyArea({ out: 0 }, [], "F") === "chronic", "D/F reliability grade = chronic even with no active outage");
ok(classifyArea({ out: 0 }, [], "A") === "none", "good grade + no outage = none");
ok(classifyArea({ out: 5000 }, ["Winter Storm Warning"], "D") === "chronic", "grade D wins over storm-driven acute");

if (fails) { console.error(`\n${fails} leadgen test(s) FAILED`); process.exit(1); }
console.log("\nall leadgen tests passed");
