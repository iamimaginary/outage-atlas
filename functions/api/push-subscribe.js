// Cloudflare Pages Function → /api/push-subscribe. Wrapper over the platform-agnostic handler.
// Needs the SUBS_KV binding (+ optional ALLOW_ORIGIN) on the Pages project.
import worker from "../../workers/push-subscribe.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
