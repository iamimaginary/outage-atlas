// Meta Threads publisher (official Threads API, graph.threads.net) — a second client behind the shared
// publish() interface (handoff §2.6). Dependency-free. Two-step flow like Instagram: create a media
// container, then publish it. Unlike Bluesky, Threads AUTO-LINKIFIES URLs, so we just post the text
// (which already contains the link) — no facets/embeds to build.
//
//   const th = makeThreads({ userId, accessToken });   // -> { name, publish }
//   await th.publish({ text }, { createdAt });
//
// Auth: a Threads user access token (short-lived → 60-day long-lived, refreshable) minted from a Meta
// app with scopes threads_basic + threads_content_publish. Supplied via env (THREADS_USER_ID,
// THREADS_ACCESS_TOKEN). Rate limits (~250 posts/24h) sit well above our own throttle.
const BASE = "https://graph.threads.net/v1.0";

async function post(url) {
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(30000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`threads ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

export function makeThreads({ userId, accessToken }) {
  const publish = async ({ text }) => {
    if (!userId || !accessToken) throw new Error("threads: THREADS_USER_ID / THREADS_ACCESS_TOKEN not set");
    // 1) create a TEXT media container
    const create = new URL(`${BASE}/${userId}/threads`);
    create.searchParams.set("media_type", "TEXT");
    create.searchParams.set("text", text);
    create.searchParams.set("access_token", accessToken);
    const { id: creationId } = await post(create.toString());
    if (!creationId) throw new Error("threads: no creation id returned");
    // 2) publish the container
    const pub = new URL(`${BASE}/${userId}/threads_publish`);
    pub.searchParams.set("creation_id", creationId);
    pub.searchParams.set("access_token", accessToken);
    const res = await post(pub.toString());
    return { ok: true, id: res.id };
  };
  return { name: "threads", publish };
}
