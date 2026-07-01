// Read-only subscriber list for the collector (/api/push-subscribers). Bearer-gated with PUSH_READ_TOKEN.
// Returns [{endpoint, fips}] for the payload-less send. NOTE: a push endpoint is NOT a send capability on
// its own — pushes are only accepted when signed by OUR VAPID key (the applicationServerKey the sub was
// created with), so this list can't be used to push to anyone without VAPID_PRIVATE_KEY. Still bearer-gate
// it (it reveals the subscriber population) and rotate the token on leak.
//
// GET  → list all {endpoint, fips} (cursor-paginated; KV list caps at 1000/page).
// DELETE ?hash=<endpointHash>&fips=<fips> → prune a dead subscription (called by the collector on 404/410).
//
// Env: SUBS_KV (binding), PUSH_READ_TOKEN (secret).

// constant-time-ish string compare (Workers has no timingSafeEqual)
function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request, env = {}) {
    if (!env.SUBS_KV || !env.PUSH_READ_TOKEN) return json({ error: "push not configured" }, 503);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEq(token, env.PUSH_READ_TOKEN)) return json({ error: "unauthorized" }, 401);

    if (request.method === "DELETE") {
      const u = new URL(request.url);
      const hash = (u.searchParams.get("hash") || "").replace(/[^a-f0-9]/g, "");
      const fips = (u.searchParams.get("fips") || "").replace(/[^0-9]/g, "");
      if (hash && fips) { await env.SUBS_KV.delete(`sub:${fips}:${hash}`); await env.SUBS_KV.delete(`ep:${hash}`); }
      return json({ ok: true }, 200);
    }
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    const out = [];
    let cursor;
    do {
      const list = await env.SUBS_KV.list({ prefix: "sub:", cursor, limit: 1000 });
      for (const k of list.keys) if (k.metadata && k.metadata.endpoint) out.push({ endpoint: k.metadata.endpoint, fips: k.metadata.fips });
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
    return json({ subscribers: out }, 200);
  },
};
