// Cloudflare Access verification — the real security boundary for the admin API.
//
// Cloudflare Access (Zero Trust) sits in front of admin.outageatlas.com and, on every allowed request,
// injects a signed JWT in the `Cf-Access-Jwt-Assertion` header (and a `CF_Authorization` cookie). We do
// NOT trust the edge rule alone: we verify the JWT's signature, audience, and expiry here too, so the
// admin API is safe even if someone reaches the Function directly on a non-protected hostname. If the
// token is missing/invalid, the caller gets 403 — the endpoint never runs.
//
// Config (env, set in the Pages project):
//   ACCESS_TEAM_DOMAIN  e.g. "yourteam.cloudflareaccess.com"  (Zero Trust → Settings → Custom Pages / team domain)
//   ACCESS_AUD          the Application Audience (AUD) tag of the Access application protecting the admin app
// Optional:
//   ACCESS_EMAILS       comma-separated allowlist; if set, the token's email must be in it (belt & braces)
//
// The signing keys are fetched from https://<team>/cdn-cgi/access/certs (JWKS) and cached in-memory.

let _jwks = null, _jwksAt = 0;
const JWKS_TTL = 3600_000; // 1h

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

// Parse a JWT into {header, payload, signingInput, signature} WITHOUT verifying (pure; unit-tested).
export function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed jwt");
  const header = JSON.parse(b64urlToStr(parts[0]));
  const payload = JSON.parse(b64urlToStr(parts[1]));
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: b64urlToBytes(parts[2]) };
}

// Validate registered claims against expectations (pure; unit-tested). `now` in seconds.
export function checkClaims(payload, { aud, now, emails }) {
  if (!payload || typeof payload !== "object") throw new Error("no claims");
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
  if (payload.nbf && now < payload.nbf) throw new Error("token not yet valid");
  if (aud) {
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) throw new Error("audience mismatch");
  }
  if (emails && emails.length) {
    const em = String(payload.email || "").toLowerCase();
    if (!emails.map((e) => e.trim().toLowerCase()).includes(em)) throw new Error("email not allowed");
  }
  return payload.email || payload.sub || "authenticated";
}

async function getJwks(teamDomain, fetchImpl = fetch, now = Date.now()) {
  if (_jwks && now - _jwksAt < JWKS_TTL) return _jwks;
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`jwks fetch ${r.status}`);
  const body = await r.json();
  _jwks = body.keys || [];
  _jwksAt = now;
  return _jwks;
}

async function verifySignature(jwk, signingInput, signature) {
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature,
    new TextEncoder().encode(signingInput));
}

// Full verification. Returns the authenticated email; throws on any failure. `deps` injectable for tests.
export async function verifyAccess(request, env = {}, deps = {}) {
  const now = deps.now || Date.now();
  const fetchImpl = deps.fetch || fetch;
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) throw new Error("access not configured"); // fail closed

  const token = request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) throw new Error("no access token");

  const { header, payload, signingInput, signature } = parseJwt(token);
  const jwks = deps.jwks || await getJwks(teamDomain, fetchImpl, now);
  const jwk = jwks.find((k) => k.kid === header.kid) || jwks[0];
  if (!jwk) throw new Error("no signing key");

  const ok = await verifySignature(jwk, signingInput, signature);
  if (!ok) throw new Error("bad signature");

  const emails = (env.ACCESS_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return checkClaims(payload, { aud, now: Math.floor(now / 1000), emails });
}

// Convenience gate used by admin Functions. Returns {email} or a Response(403) to short-circuit.
export async function requireAdmin(request, env, deps) {
  try {
    const email = await verifyAccess(request, env, deps);
    return { email };
  } catch (e) {
    return {
      response: new Response(JSON.stringify({ error: "forbidden", reason: String(e.message || e) }), {
        status: 403, headers: { "Content-Type": "application/json" },
      }),
    };
  }
}

// test-only: reset the JWKS cache between cases
export function _resetJwksCache() { _jwks = null; _jwksAt = 0; }
