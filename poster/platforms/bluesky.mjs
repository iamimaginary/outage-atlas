// Bluesky publisher (AT Protocol XRPC over HTTPS) — one client behind the shared publish() interface
// (handoff §2.5/§2.6). Dependency-free: two calls, createSession then createRecord, with hand-rolled
// facets (../facets.mjs). Auth uses an APP PASSWORD (never the account password) supplied via env.
//
//   const bsky = makeBluesky({ handle, appPassword });   // -> { name, publish }
//   await bsky.publish({ text, link, image }, { createdAt });
import { detectFacets } from "../facets.mjs";

const BASE = "https://bsky.social/xrpc";

async function xrpc(method, body, headers = {}) {
  const r = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`bluesky ${method} -> ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
  return r.json();
}

export function makeBluesky({ handle, appPassword }) {
  let session = null;
  const login = async () => {
    if (session) return session;
    if (!handle || !appPassword) throw new Error("bluesky: BLUESKY_HANDLE / BLUESKY_APP_PASSWORD not set");
    session = await xrpc("com.atproto.server.createSession", { identifier: handle, password: appPassword });
    return session;
  };

  const publish = async ({ text, link }, { createdAt } = {}) => {
    const { accessJwt, did } = await login();
    const auth = { Authorization: `Bearer ${accessJwt}` };
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: createdAt || new Date().toISOString(),
      facets: detectFacets(text),
    };
    // link card (explicit external embed is more reliable than hoping Bluesky scrapes OG).
    if (link) record.embed = { $type: "app.bsky.embed.external", external: { uri: link, title: "Outage Atlas — live outage map", description: "Live power-outage status and recovery estimate for this area." } };
    const res = await xrpc("com.atproto.repo.createRecord", { repo: did, collection: "app.bsky.feed.post", record }, auth);
    return { ok: true, uri: res.uri, cid: res.cid };
  };

  return { name: "bluesky", publish };
}
