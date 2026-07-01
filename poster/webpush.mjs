// Web Push sender — pure node:crypto, dependency-free (no `web-push` lib). PAYLOAD-LESS push only:
// we POST an EMPTY body (no RFC 8291 aes128gcm encryption), so the only crypto is the VAPID ES256 JWT.
// The service worker builds the notification text from the public baseline snapshot on receipt.
//
// THE #1 GOTCHA: node's default ECDSA signature is ASN.1 DER (~70-72B), which JWS/ES256 REJECTS (401/403).
// `dsaEncoding: "ieee-p1363"` emits the required raw 64-byte R‖S. Verified in scripts/test_webpush.mjs.
import { createSign } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Mint a VAPID JWT for a subscription endpoint. aud = the endpoint's ORIGIN (scheme+host), not its path;
// one JWT is valid for every subscription sharing that push-service origin. exp must be <= 24h ahead.
export function vapidJwt(endpoint, subject, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject }));
  const signingInput = `${header}.${claims}`;
  const sig = createSign("SHA256").update(signingInput).sign({ key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
}

// Send one payload-less push. Returns the HTTP status. NOTE: do NOT set Content-Length (forbidden header,
// silently dropped) and do NOT set Content-Encoding (that would signal an encrypted RFC 8291 body).
export async function sendPush(endpoint, { jwt, publicKey, ttl = 86400, urgency = "high", topic } = {}) {
  const headers = { Authorization: `vapid t=${jwt}, k=${publicKey}`, TTL: String(ttl), Urgency: urgency };
  if (topic) headers.Topic = topic; // collapses queued pushes for the same area at the push service
  try {
    const r = await fetch(endpoint, { method: "POST", headers, signal: AbortSignal.timeout(20000) });
    return r.status;
  } catch { return 0; } // network error — leave the subscription in place, retry next cycle
}

// A subscription is dead ONLY on 404/410 (unsubscribed/expired). 401/403 = auth/signature bug (fix the
// signer, don't delete). 429 = rate limited (respect + retry). 2xx = accepted.
export const isGone = (status) => status === 404 || status === 410;
export const isAccepted = (status) => status >= 200 && status < 300;
