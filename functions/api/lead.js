// Cloudflare Pages Function → route /api/lead. Thin wrapper over the platform-agnostic handler in
// workers/lead.mjs. Set env LEAD_WEBHOOK_URL (+ optional LEADS_KV binding, ALLOW_ORIGIN) in the Pages
// project. Forwards leads to your webhook; stores/logs no PII.
import worker from "../../workers/lead.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
