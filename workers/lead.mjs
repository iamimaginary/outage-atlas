// Backup-generator lead intake (handoff Phase 6) — serverless fetch handler for the "free whole-home
// backup quote" form on chronic/blue-sky areas. Validates + honeypot + rate-limit, then FORWARDS the
// lead to the operator's configured webhook (a Zapier/CRM/dealer endpoint). Stores nothing itself.
//
// Deploy at the site origin path `/api/lead` (same-origin keeps the page CSP at connect-src 'self').
// Required env: LEAD_WEBHOOK_URL (where leads are POSTed as JSON). Optional: ALLOW_ORIGIN, LEADS_KV.
//
// PII NOTE (guardrail): a lead contains name + phone. This handler NEVER logs the payload and NEVER
// writes it to this repo — it only relays to the operator's webhook over HTTPS. Keep it that way.

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
});

export default {
  async fetch(request, env = {}) {
    const origin = env.ALLOW_ORIGIN || "*";
    if (request.method === "OPTIONS") return json({}, 204, origin);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

    let b;
    try { b = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
    if (b.hp) return json({ ok: true }, 200, origin); // honeypot -> silent success

    const name = String(b.name || "").trim().slice(0, 120);
    const zip = String(b.zip || "").trim();
    const phone = String(b.phone || "").trim().slice(0, 40);
    const type = b.type === "portable" ? "portable" : "whole-home";
    if (!name || !/^\d{5}$/.test(zip) || phone.replace(/\D/g, "").length < 10) return json({ error: "invalid lead" }, 422, origin);

    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
    if (env.LEADS_KV && ip) {
      const key = `rl:${ip}`;
      const hits = Number((await env.LEADS_KV.get(key)) || 0);
      if (hits >= 5) return json({ error: "too many requests" }, 429, origin);
      await env.LEADS_KV.put(key, String(hits + 1), { expirationTtl: 3600 });
    }

    if (!env.LEAD_WEBHOOK_URL) return json({ error: "leads not configured" }, 503, origin);

    const lead = { name, zip, phone, type, area: String(b.area || "").slice(0, 120), fips: String(b.fips || "").replace(/[^0-9]/g, "").slice(0, 5), source: "outage-atlas", ts: new Date().toISOString() };
    try {
      const r = await fetch(env.LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
      if (!r.ok) return json({ error: "forward failed" }, 502, origin);
      return json({ ok: true }, 200, origin);
    } catch {
      return json({ error: "upstream unreachable" }, 502, origin);
    }
  },
};
