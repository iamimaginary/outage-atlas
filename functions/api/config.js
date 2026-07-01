// Cloudflare Pages Function → route /api/config. Thin wrapper over workers/config.mjs. Serves the
// current runtime settings (ads/affiliates/flags/banner) the operator edits in the admin portal.
// Requires the D1 binding ANALYTICS_DB (falls back to defaults if absent).
import worker from "../../workers/config.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
