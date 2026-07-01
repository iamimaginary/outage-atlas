// Email capture intake (handoff Phase 3) — the owned-list asset. Serverless fetch handler
// (Cloudflare Workers / Pages Functions / Vercel / Netlify). Receives the page's "alert me when my
// area loses power" form, then hands the address to an email provider with DOUBLE OPT-IN so the
// confirmation + unsubscribe (CAN-SPAM) are the provider's job, not ours.
//
// Deploy at the SITE ORIGIN path `/api/subscribe` (e.g. a Cloudflare route on outageatlas.com/api/*)
// so the page can POST same-origin — keeps the page CSP at `connect-src 'self'`, no new origins.
//
// Required env: EMAIL_PROVIDER (buttondown), EMAIL_API_KEY.
// Optional env: ALLOW_ORIGIN (default "*"), SUBS_KV (a KV namespace binding for per-IP rate-limiting).
//
// Privacy: we store NOTHING ourselves — the address goes straight to the provider. No PII touches this
// repo (guardrail). The provider owns the list + the unsubscribe link.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
});

export default {
  async fetch(request, env = {}) {
    const origin = env.ALLOW_ORIGIN || "*";
    if (request.method === "OPTIONS") return json({}, 204, origin);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
    const email = String(body.email || "").trim().toLowerCase();
    const zip = String(body.zip || "").trim().slice(0, 10);
    const fips = String(body.fips || "").trim().replace(/[^0-9]/g, "").slice(0, 5);

    // honeypot: a hidden field a human never fills. If present, silently 200 (don't tip off bots).
    if (body.hp) return json({ ok: true }, 200, origin);
    if (!EMAIL_RE.test(email)) return json({ error: "invalid email" }, 422, origin);

    // best-effort per-IP rate limit (needs a KV binding; skipped gracefully if absent).
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
    if (env.SUBS_KV && ip) {
      const key = `rl:${ip}`;
      const hits = Number((await env.SUBS_KV.get(key)) || 0);
      if (hits >= 5) return json({ error: "too many requests" }, 429, origin);
      await env.SUBS_KV.put(key, String(hits + 1), { expirationTtl: 3600 });
    }

    if (!env.EMAIL_API_KEY || (env.EMAIL_PROVIDER || "buttondown") !== "buttondown")
      return json({ error: "subscriptions not configured" }, 503, origin);

    // Buttondown: create subscriber. With double opt-in enabled on the account, Buttondown emails the
    // confirmation itself. metadata carries the area so alerts can segment by county later.
    try {
      const r = await fetch("https://api.buttondown.email/v1/subscribers", {
        method: "POST",
        headers: { Authorization: `Token ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email_address: email, tags: [zip && `zip:${zip}`, fips && `fips:${fips}`].filter(Boolean), metadata: { zip, fips }, referrer_url: "outage-atlas" }),
      });
      if (r.status === 409) return json({ ok: true, already: true }, 200, origin); // already subscribed
      if (!r.ok) return json({ error: "provider error" }, 502, origin);
      return json({ ok: true, doubleOptIn: true }, 200, origin);
    } catch {
      return json({ error: "upstream unreachable" }, 502, origin);
    }
  },
};
