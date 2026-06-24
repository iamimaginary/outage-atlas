// Pure audit logic — the single source of truth for every detector, extracted so the audit scripts AND
// the "audit the auditors" tests (scripts/test_audits.mjs) exercise the SAME code. No I/O, no network.
// The user's mandate: the audits (and the agents that act on them) must operate flawlessly, so the
// detection rules live here, unit-tested against deliberately-broken inputs.

// ODIN payload shape vs what the adapter relies on.
export function analyzeOdinShape(records, required, known) {
  const knownSet = known instanceof Set ? known : new Set(known);
  const seen = new Set();
  for (const r of records || []) for (const k of Object.keys(r)) seen.add(k);
  return {
    seen: [...seen],
    missingRequired: required.filter((k) => !seen.has(k)), // -> FAIL (adapter will mis-parse)
    newKeys: [...seen].filter((k) => !knownSet.has(k)),    // -> WARN (drift signal)
    vanished: [...knownSet].filter((k) => !seen.has(k))    // -> WARN
  };
}

// Per-utility reconciliation: our summed areas vs the source's own published headline.
export function reconcile(summed, official, tolPct = 15, floor = 200) {
  if (typeof official !== "number") return { ok: false, skipped: false, pct: null, reason: "no official total" };
  if (Math.max(summed, official) < floor) return { ok: true, skipped: true, pct: 0 };
  const pct = (Math.abs(summed - official) / Math.max(official, 1)) * 100;
  return { ok: pct <= tolPct, skipped: false, pct };
}

// Coverage regression: which previously-observed states are now absent.
export function coverageRegression(currentStates, expectedStates) {
  const now = new Set(currentStates || []);
  return { missing: (expectedStates || []).filter((s) => !now.has(s)) };
}

// Baseline <-> deep cross-source agreement (independent pipelines -> generous tolerance).
export function crossSourceAgree(deepOut, baseOut, tolPct = 60, floor = 300) {
  if (Math.max(deepOut, baseOut) < floor) return { ok: true, skipped: true, pct: 0 };
  const pct = (Math.abs(deepOut - baseOut) / Math.max(baseOut, 1)) * 100;
  return { ok: pct <= tolPct, skipped: false, pct };
}

// ToS guardrail (poweroutage.us): a CODE reference to poweroutage without a user-supplied license key
// is a STOP -> needs-human. poweroutage.us prohibits unlicensed/scraped use; only the operator may
// enable it with their own license. `codeText` is the concatenated source to scan; `hasLicenseKey` is
// whether POWEROUTAGE_LICENSE_KEY is set.
export function tosViolation(codeText, hasLicenseKey) {
  const hit = /poweroutage/i.test(codeText || "");
  if (hit && !hasLicenseKey) return { stop: true, label: "needs-human", reason: "poweroutage.us reference in code without a user-supplied license key (ToS) — escalate, do not implement." };
  return { stop: false };
}

// Stable dedupe signature for an auto-filed issue, so a recurring failure updates ONE issue.
export function issueSignature(kind, key) {
  return `<!-- oa-audit:${kind}:${key} -->`;
}
