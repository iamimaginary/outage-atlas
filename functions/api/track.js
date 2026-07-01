// Cloudflare Pages Function → route /api/track. Thin wrapper over workers/track.mjs (same-origin so the
// page CSP stays connect-src 'self'). Requires a D1 binding named ANALYTICS_DB; optional env VID_SALT.
import worker from "../../workers/track.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
