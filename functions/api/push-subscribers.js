// Cloudflare Pages Function → /api/push-subscribers. Wrapper over the read-only, bearer-gated list.
// Needs SUBS_KV binding + PUSH_READ_TOKEN secret on the Pages project.
import worker from "../../workers/push-subscribers.mjs";
export const onRequest = (ctx) => worker.fetch(ctx.request, ctx.env);
