// Subscriber alerts — Web Push edition (replaces email). Reuses the SAME per-area detection that drives
// social posts so an onset that fires also pushes to the devices watching that county. Split like the
// poster: a PURE FIPS-join matcher (unit-tested) + an env-gated, DRY-RUN-by-default sender.
//
//   matchSubscribers(areaEvents, subscribers) -> [ {endpoint, event} ]   // PURE
//   deliverPush(matches, opts)                -> sends payload-less VAPID pushes (+ prunes 404/410)
//
// Subscribers come from the bearer-gated /api/push-subscribers list as [{endpoint, fips}].
import { createHash } from "node:crypto";
import { vapidJwt, sendPush, isGone, isAccepted } from "./webpush.mjs";

// which per-area events warrant a push. onset + restored (the all-clear the user asked for) + escalation
// (updates in place via the SW's per-FIPS tag, so no spam). Override with NOTIFY_TYPES.
const ALERT_TYPES = (process.env.NOTIFY_TYPES || "onset,escalation,restored").split(",").map((s) => s.trim());

export function matchSubscribers(areaEvents, subscribers, types = ALERT_TYPES) {
  const byFips = {};
  for (const s of subscribers || []) if (s && s.endpoint && s.fips) (byFips[s.fips] = byFips[s.fips] || []).push(s.endpoint);
  const out = [];
  for (const e of areaEvents || []) {
    if (!types.includes(e.type)) continue;
    for (const endpoint of byFips[e.fips] || []) out.push({ endpoint, event: e });
  }
  return out;
}

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

// Env-gated. DRY-RUN unless PUSH_ENABLED=1 + VAPID keys present. Mints one JWT per push-service origin
// per run (the SW builds the notification text — payload-less). Prunes dead subs (404/410) via the
// bearer-gated prune endpoint.
export async function deliverPush(matches, { subject, publicKey, privateKey, pruneUrl, pruneToken } = {}) {
  const enabled = process.env.PUSH_ENABLED === "1" && privateKey && publicKey;
  if (!enabled) {
    for (const m of matches) console.log(`  [push dry-run] ${m.event.type} ${m.event.fips} -> ${hostOf(m.endpoint)}`);
    return { sent: 0, pruned: 0, dryRun: true };
  }
  const jwtByOrigin = {};
  let sent = 0, pruned = 0;
  for (const m of matches) {
    let origin;
    try { origin = new URL(m.endpoint).origin; } catch { continue; }
    const jwt = jwtByOrigin[origin] || (jwtByOrigin[origin] = vapidJwt(m.endpoint, subject, privateKey));
    const status = await sendPush(m.endpoint, { jwt, publicKey, topic: `fips-${m.event.fips}` });
    if (isAccepted(status)) sent++;
    else if (isGone(status)) { pruned++; await prune(m.endpoint, m.event.fips, pruneUrl, pruneToken); }
    // 401/403 (auth/signature) / 429 (rate) / 0 (network): leave in place, retry next cycle.
  }
  return { sent, pruned, dryRun: false };
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return "?"; } };

async function prune(endpoint, fips, pruneUrl, token) {
  if (!pruneUrl || !token) return;
  try {
    await fetch(`${pruneUrl}?hash=${sha256hex(endpoint)}&fips=${fips}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  } catch { /* prune is best-effort; the KV TTL is the backstop */ }
}
