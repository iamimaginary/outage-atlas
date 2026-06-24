// "Audit the auditors." Feeds each detector deliberately-broken input and asserts it FIRES — so the
// scheduled audit agents can't go silently blind. Also asserts the poweroutage ToS guard routes to STOP
// without a key, and to allowed WITH one. Pure (no network). Exits non-zero on any failure.
import { analyzeOdinShape, reconcile, coverageRegression, crossSourceAgree, tosViolation, issueSignature } from "./lib/audits.mjs";

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log("✓ " + msg); else { failed++; console.error("✗ " + msg); } };

// 1) ODIN shape drift: a dropped required field must be detected; a brand-new field flagged
const required = ["communitydescriptor", "metersaffected"];
const known = new Set(["communitydescriptor", "metersaffected", "county"]);
const drift = analyzeOdinShape([{ communitydescriptor: "39035", county: "X", surprise_field: 1 }], required, known);
ok(drift.missingRequired.includes("metersaffected"), "drift: detects a dropped REQUIRED field");
ok(drift.newKeys.includes("surprise_field"), "drift: flags a NEW field (drift signal)");
ok(analyzeOdinShape([{ communitydescriptor: "1", metersaffected: 2 }], required, known).missingRequired.length === 0, "drift: clean when required fields present");

// 2) reconciliation: divergence beyond tolerance fails; match passes; tiny totals skip
ok(reconcile(274, 1979, 15).ok === false, "reconcile: FIRES on the spike's multi-state gap (274 vs 1979)");
ok(reconcile(1000, 1010, 15).ok === true, "reconcile: passes a within-tolerance match");
ok(reconcile(50, 60, 15, 200).skipped === true, "reconcile: skips below the floor");
ok(reconcile(5, null, 15).ok === false, "reconcile: fails when there is no official total");

// 3) coverage regression: an expected state gone missing is caught
ok(coverageRegression(["Ohio", "Texas"], ["Ohio", "Texas", "Florida"]).missing.includes("Florida"), "coverage: detects a regressed (now-absent) state");
ok(coverageRegression(["Ohio", "Texas"], ["Ohio"]).missing.length === 0, "coverage: clean when all expected present");

// 4) cross-source: gross baseline<->deep divergence fires; close enough passes
ok(crossSourceAgree(5000, 500, 60, 300).ok === false, "cross-source: FIRES on gross divergence (5000 vs 500)");
ok(crossSourceAgree(1000, 900, 60, 300).ok === true, "cross-source: passes when reasonably close");
ok(crossSourceAgree(50, 40, 60, 300).skipped === true, "cross-source: skips below the floor");

// 5) ToS guard: poweroutage in code without a key -> STOP/needs-human; with a key -> allowed; absent -> ok
const stop = tosViolation('const U = "https://poweroutage.us/api";', false);
ok(stop.stop === true && stop.label === "needs-human", "ToS: poweroutage-without-key routes to STOP/needs-human");
ok(tosViolation('fetch("https://poweroutage.us")', true).stop === false, "ToS: operator-licensed (key present) is allowed");
ok(tosViolation('const x = "https://ornl.opendatasoft.com";', false).stop === false, "ToS: no false-positive on unrelated code");

// 6) issue dedupe signature is stable
ok(issueSignature("drift", "odin") === issueSignature("drift", "odin"), "issue signature is stable for dedupe");

console.log(`\n${failed ? failed + " FAILED" : "all audit-the-auditor tests passed"}`);
process.exit(failed ? 1 : 0);
