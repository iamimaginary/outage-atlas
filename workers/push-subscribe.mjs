// Web Push subscription intake (Phase 3, push edition) — serverless fetch handler for /api/push-subscribe.
// POST = subscribe, DELETE = unsubscribe. Stores ONLY {endpoint, fips} (payload-less push needs no
// encryption keys) in Cloudflare KV — private, never the repo. Guards: real-push-service origin
// allowlist, honeypot, per-IP rate limit.
//
// KV layout (data lives in the key's metadata so the collector's list() needs no per-key GET):
//   sub:<fips>:<endpointHash>   metadata {endpoint, fips}          (the subscriber record)
//   ep:<endpointHash>           value = fips                        (reverse lookup for unsubscribe/prune)
// Both carry a ~180d expirationTtl as a backstop against undead subscriptions.
//
// Env: SUBS_KV (binding). Optional: ALLOW_ORIGIN.

const TTL = 180 * 24 * 3600;
// Only accept endpoints on the real push services (block junk that would inflate the send fan-out).
const ALLOWED = ["googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
const okOrigin = (u) => { try { const h = new URL(u).hostname; return ALLOWED.some((s) => h === s || h.endsWith("." + s)); } catch { return false; } };

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
});

export default {
  async fetch(request, env = {}) {
    const origin = env.ALLOW_ORIGIN || "*";
    if (request.method === "OPTIONS") return json({}, 204, origin);
    if (!env.SUBS_KV) return json({ error: "push not configured" }, 503, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, origin); }
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || "");
    const fips = String(body.fips || "").replace(/[^0-9]/g, "").slice(0, 5);
    if (!/^https:\/\//.test(endpoint) || !okOrigin(endpoint)) return json({ error: "invalid endpoint" }, 422, origin);
    const hash = await sha256hex(endpoint);

    if (request.method === "DELETE") {
      const f = (await env.SUBS_KV.get(`ep:${hash}`)) || fips;
      if (f) await env.SUBS_KV.delete(`sub:${f}:${hash}`);
      await env.SUBS_KV.delete(`ep:${hash}`);
      return json({ ok: true }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

    if (body.hp) return json({ ok: true }, 200, origin); // honeypot → silent success
    if (!/^\d{5}$/.test(fips)) return json({ error: "invalid area" }, 422, origin);

    // best-effort per-IP rate limit
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
    if (ip) {
      const key = `rl:${ip}`, hits = Number((await env.SUBS_KV.get(key)) || 0);
      if (hits >= 10) return json({ error: "too many requests" }, 429, origin);
      await env.SUBS_KV.put(key, String(hits + 1), { expirationTtl: 3600 });
    }

    await env.SUBS_KV.put(`sub:${fips}:${hash}`, "", { metadata: { endpoint, fips }, expirationTtl: TTL });
    await env.SUBS_KV.put(`ep:${hash}`, fips, { expirationTtl: TTL });
    return json({ ok: true }, 200, origin);
  },
};
