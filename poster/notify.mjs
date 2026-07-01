// Subscriber alerts (handoff Phase 3) — reuse the SAME event detection that drives social posts so an
// onset that fires also emails the people who asked to watch that area. Split like the poster:
//   matchSubscribers(areaEvents, subscribers)  -> [ {email, event} ]   // PURE, tested
//   deliverAlerts(matches, opts)               -> sends (env-gated; DRY-RUN by default)
//
// Subscribers are stored by the email provider (the owned list); at capture time the page resolves the
// user's ZIP -> county FIPS (via web/geo.mjs) so matching is a pure FIPS join here — no geocoding at
// send time. `subscribers` = [ { email, fips } ].
import { CONFIG } from "./config.mjs";

// which per-area event types warrant an email. Escalations are intentionally excluded (too noisy for
// an inbox); "your area lost power" (onset) and "power's back" (restored) are the high-value ones.
const ALERT_TYPES = (process.env.NOTIFY_TYPES || "onset,restored").split(",").map((s) => s.trim());

export function matchSubscribers(areaEvents, subscribers, types = ALERT_TYPES) {
  const byFips = {};
  for (const s of subscribers || []) if (s && s.email && s.fips) (byFips[s.fips] = byFips[s.fips] || []).push(s.email);
  const out = [];
  for (const e of areaEvents || []) {
    if (!types.includes(e.type)) continue;
    for (const email of byFips[e.fips] || []) out.push({ email, event: e });
  }
  return out;
}

// Subject/body for one alert (kept plain; the provider wraps it with the required unsubscribe footer).
export function renderAlert(event, url) {
  if (event.type === "restored")
    return { subject: `✅ Power mostly restored in ${event.name}`, text: `Good news — power is mostly back in ${event.name} (down to ${Number(event.out).toLocaleString("en-US")} still out from a peak of ${Number(event.peak).toLocaleString("en-US")}).\n\nLive status: ${url}\n\nYou're getting this because you asked Outage Atlas to watch this area. Unsubscribe any time via the link below. Not affiliated with any utility.` };
  return { subject: `⚡ Power outage in ${event.name}`, text: `An outage was just detected in ${event.name}: about ${Number(event.out).toLocaleString("en-US")} customers out.\n\nLive status + recovery estimate: ${url}\n\nYou're getting this because you asked Outage Atlas to watch this area. Unsubscribe any time via the link below. Not affiliated with any utility.` };
}

// Env-gated delivery. Real send requires NOTIFY_ENABLED=1 + a provider key + a SUBSCRIBERS_URL that
// returns [{email,fips}]. Absent any of those it's a DRY-RUN (logs, sends nothing) — same discipline
// as the social poster. Returns {sent, dryRun}.
export async function deliverAlerts(matches, { urlFor, provider = process.env.EMAIL_PROVIDER } = {}) {
  const enabled = process.env.NOTIFY_ENABLED === "1" && provider && process.env.EMAIL_API_KEY;
  if (!enabled) {
    for (const m of matches) console.log(`  [alert dry-run] ${m.event.type} ${m.event.fips} -> ${m.email}`);
    return { sent: 0, dryRun: true };
  }
  let sent = 0;
  for (const m of matches) {
    const { subject, text } = renderAlert(m.event, urlFor ? urlFor(m.event) : (process.env.POSTER_URL_BASE || ""));
    try { await sendOne(provider, m.email, subject, text); sent++; }
    catch (err) { console.error(`  ::warning:: alert send failed for ${m.email}: ${err.message}`); }
  }
  return { sent, dryRun: false };
}

// Minimal transactional send. Buttondown is the default (native double opt-in + CAN-SPAM unsubscribe);
// extend with more providers behind this one switch.
async function sendOne(provider, email, subject, text) {
  if (provider === "buttondown") {
    const r = await fetch("https://api.buttondown.email/v1/emails", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body: text }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`buttondown ${r.status}`);
    return;
  }
  throw new Error(`unknown EMAIL_PROVIDER "${provider}"`);
}

export { CONFIG };
