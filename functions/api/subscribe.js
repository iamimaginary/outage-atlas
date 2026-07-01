// Cloudflare Pages Function → route /api/subscribe. Thin wrapper over the platform-agnostic handler in
// workers/subscribe.mjs (same-origin so the page CSP stays connect-src 'self'). Set env EMAIL_PROVIDER,
// EMAIL_API_KEY (+ optional SUBS_KV binding, ALLOW_ORIGIN) in the Pages project.
import worker from "../../workers/subscribe.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
