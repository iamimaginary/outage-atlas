// Admin API — the authenticated backend for admin.outageatlas.com. Every route is gated by
// requireAdmin() (Cloudflare Access JWT verification). Routes:
//   GET  /admin/api/stats?days=30   → aggregate, privacy-preserving analytics
//   GET  /admin/api/settings        → full editable settings (for the editor)
//   PUT  /admin/api/settings        → save edited settings
//   GET  /admin/api/whoami          → the authenticated admin email (portal header)
//
// The admin app is served from admin.outageatlas.com, which is protected by a Cloudflare Access
// application. We ALSO verify the Access JWT here so the API is safe even if hit directly.

import { requireAdmin } from "./lib/access.mjs";
import { stats, getSettings, putSettings, ensureSchema, sanitizeSettings, dayOf } from "./lib/db.mjs";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default {
  async fetch(request, env = {}, deps = {}) {
    const url = new URL(request.url);
    // route is the path after /admin/api
    const route = url.pathname.replace(/^.*\/admin\/api/, "").replace(/\/+$/, "") || "/";

    // AUTH — fail closed
    const auth = await requireAdmin(request, env, deps.access);
    if (auth.response) return auth.response;

    const db = env.ANALYTICS_DB;
    if (!db) return json(503, { error: "analytics DB not configured (bind ANALYTICS_DB)" });

    const now = deps.now || Date.now();
    const today = dayOf(now);

    try {
      if (route === "/whoami") return json(200, { email: auth.email });

      if (route === "/stats" && request.method === "GET") {
        const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
        let out;
        try { out = await stats(db, { days, today }); }
        catch { await ensureSchema(db); out = await stats(db, { days, today }); }
        return json(200, out);
      }

      if (route === "/settings" && request.method === "GET") {
        let s;
        try { s = await getSettings(db); } catch { await ensureSchema(db); s = await getSettings(db); }
        return json(200, s);
      }

      if (route === "/settings" && request.method === "PUT") {
        let body;
        try { body = await request.json(); } catch { return json(400, { error: "bad json" }); }
        let saved;
        try { saved = await putSettings(db, body, now); }
        catch { await ensureSchema(db); saved = await putSettings(db, body, now); }
        return json(200, { ok: true, settings: saved });
      }

      // preview sanitizer without saving (portal "validate" affordance)
      if (route === "/settings/preview" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { return json(400, { error: "bad json" }); }
        return json(200, { settings: sanitizeSettings(body) });
      }

      return json(404, { error: "not found", route });
    } catch (e) {
      return json(500, { error: "server error", detail: String(e.message || e) });
    }
  },
};
