// Cloudflare Pages Function → catch-all route /admin/api/*. Thin wrapper over workers/admin.mjs, which
// verifies the Cloudflare Access JWT before doing anything. Bind D1 as ANALYTICS_DB and set env
// ACCESS_TEAM_DOMAIN + ACCESS_AUD (+ optional ACCESS_EMAILS) on the Pages project.
import worker from "../../../workers/admin.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
