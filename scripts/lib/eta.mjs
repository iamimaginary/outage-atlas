// Algorithmic power-recovery estimator — the universal layer that gives EVERY county (hence every ZIP,
// via the resolver) a recovery time from the ODIN baseline alone, no per-utility feed required. Ported
// from the NE Ohio app's battle-tested rateInfo: a linear restoration rate over a ~2.5h window, a
// "holding/rising" guard so a plateaued tail never reads as "restoring in 900 hours", and a bounded,
// gated deceleration correction (big outages' slow tail takes longer than the recent pace implies).
// Pure + unit-tested (scripts/test_audits.mjs). Positive rate = recovering.
//
// NOTE: a raw exponential curve fit was tried and removed in NEO — it explodes on noisy, non-monotonic
// real data (~3x worse error). The deceleration here is bounded (<=2x) and gated, so it can't blow up.

// Linear rate (customers restored/hr) from a county's history. Prefers points within ~2.5h; falls back
// to the prior collected point when collection was sparse. null if <2 points or no time elapsed.
export function restorationRate(series) {
  if (!series || series.length < 2) return null;
  const latest = series[series.length - 1];
  const WINDOW = 150 * 60 * 1000; // ~2.5h
  let start = null;
  for (let i = 0; i < series.length - 1; i++) { if (series[i].t >= latest.t - WINDOW) { start = series[i]; break; } }
  if (!start) start = series[series.length - 2];
  const hrs = (latest.t - start.t) / 3600000;
  if (hrs <= 0) return null;
  return { perHour: (start.out - latest.out) / hrs, out: latest.out };
}

export function durStr(h) {
  if (h < 1) return Math.max(1, Math.round(h * 60)) + " min";
  if (h < 24) return (h < 3 ? Math.round(h * 10) / 10 : Math.round(h)) + " hr";
  const d = Math.round((h / 24) * 10) / 10;
  return d + (d === 1 ? " day" : " days");
}

// Classify a county's recent trend + (when recovering) estimate hours-to-restore.
// peak = the running max customers-out seen for this county (drives the deceleration correction).
export function estimateRecovery(series, out, peak) {
  if (out <= 0) return { kind: "restored" };
  const r = restorationRate(series);
  if (!r) return { kind: "collecting" };
  const ph = r.perHour;
  // a change only counts as restoring/rising if it's meaningful vs how many are out
  if (Math.abs(ph) < Math.max(5, out * 0.01)) return { kind: "holding", perHour: ph };
  if (ph > 0) {
    const f = peak > 0 ? Math.max(0, Math.min(1, (peak - out) / peak)) : 0; // fraction recovered
    const decel = peak >= 1000 ? 1 + Math.min(1, Math.max(0, (f - 0.5) / 0.5)) : 1; // up to 2x, gated
    const etaHrs = (out / ph) * decel;
    return { kind: "improving", perHour: ph, etaHrs };
  }
  return { kind: "rising", perHour: -ph };
}

// Human label for the page (the collector stores this so the page stays presentation-only).
export function recoveryLabel(info) {
  switch (info.kind) {
    case "restored": return "power restored";
    case "collecting": return "estimating… (need another reading)";
    case "holding": return "holding steady — no clear recovery yet";
    case "rising": return `still rising · ~${Math.round(info.perHour)} more out/hr`;
    case "improving":
      return info.etaHrs > 48
        ? `restoring slowly · ~${Math.round(info.perHour)}/hr`
        : `~${durStr(info.etaHrs)} to restore · ~${Math.round(info.perHour)}/hr`;
  }
  return "";
}

// Confidence in a recovery estimate, from how much history backs it: more readings over a longer span
// = more trustworthy. <4 readings (<~45min) is thin; >=12 (~3h at the 15-min cadence) is solid.
export function etaConfidence(series) {
  const n = series ? series.length : 0;
  if (n < 4) return "low";
  if (n < 12) return "moderate";
  return "good";
}

// Build the stored eta object for a county (structured + a ready label).
export function countyEta(series, out, peak) {
  const info = estimateRecovery(series, out, peak);
  const eta = { kind: info.kind, label: recoveryLabel(info) };
  if (info.perHour != null) eta.perHour = Math.round(info.perHour);
  if (info.etaHrs != null) eta.etaHrs = Math.round(info.etaHrs * 10) / 10;
  if (info.kind === "improving" || info.kind === "rising") eta.confidence = etaConfidence(series);
  return eta;
}
