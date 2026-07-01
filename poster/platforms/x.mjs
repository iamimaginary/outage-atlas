// X (Twitter) publisher — a third client behind the shared publish() interface (handoff §2.6).
// Dependency-free: POST /2/tweets with OAuth 1.0a user-context signing (HMAC-SHA1 via node:crypto),
// which is the simplest auth for a single bot posting to its own account (no token-refresh dance).
// X is the PAID tier in the handoff — enabled only when all four X_* creds are set.
//
//   const x = makeX({ apiKey, apiSecret, accessToken, accessSecret });   // -> { name, publish }
//
// Notes: X auto-linkifies URLs (no facets). Tweet limit is 280 chars (< Bluesky's 300) so we trim.
// Free-tier write caps are low (well below a big storm) — our own throttle (config.mjs) is the first
// guard, but on a paid tier you may want to raise POSTER_GLOBAL_CAP. Verify current limits at
// developer.x.com — the API + pricing drift.
import { createHmac, randomBytes } from "node:crypto";

// RFC-3986 percent-encoding (encodeURIComponent + the four chars it leaves alone).
const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// Build the OAuth 1.0a Authorization header for a JSON-body request (body is NOT part of the signature;
// only the oauth_* params are, since there are no query/form params).
function authHeader(method, url, { apiKey, apiSecret, accessToken, accessSecret }) {
  const oauth = {
    oauth_consumer_key: apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join("&");
  const signingKey = `${enc(apiSecret)}&${enc(accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

export const trimForX = (text) => { const g = [...String(text)]; return g.length <= 280 ? String(text) : g.slice(0, 279).join("") + "…"; };

export function makeX(creds) {
  const publish = async ({ text }) => {
    if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessSecret) throw new Error("x: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET not all set");
    const url = "https://api.twitter.com/2/tweets";
    const auth = authHeader("POST", url, creds);
    const r = await fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: trimForX(text) }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`x ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return { ok: true, id: j.data && j.data.id };
  };
  return { name: "x", publish };
}
