// HECO serverless proxy — SCAFFOLD (Phase 5), ships DISABLED until an operator supplies a credential.
//
// Why this exists: Hawaiian Electric's outage API (outagemap-api-heco.azurewebsites.net/api/v1/outages)
// is BOTH auth-gated (Bearer JWT minted from a pre-shared key via the External Access Key Service) AND
// origin-locked (CORS allowlist -> a browser on github.io is rejected). ODIN does not cover Hawaii, so
// without this there is no path to ~95% of the state. This proxy holds the operator-supplied HECO key
// server-side, performs the token handshake, fetches outages, and returns plain JSON with an open CORS
// header so either the collector or the page can consume it. It is the one piece the runbook calls out
// as needing a human (a HECO-issued credential) — see CLAUDE.md STOP rule on gated sources.
//
// Deploy target: any serverless runtime with a fetch() handler (Cloudflare Workers / Vercel / Netlify).
// Required secret/env: HECO_ACCESS_KEY (the pre-shared key HECO issues to an operator).
// Optional env: HECO_COMPANY (HECO|MECO|HELCO, default HECO), ALLOW_ORIGIN (default "*").
//
// UNKNOWNS to fill once a key + a browser DevTools capture exist (the public client did not expose them):
//   - the exact Access-Key-Service route + how the key is presented (Authorization header vs body),
//   - the precise /outages request body (extent + spatialReference) and the per-incident customers field.
// Those are isolated to fetchOutages() below; the parser (adapters/heco.mjs) is already in place.

const ACCESS_BASE = "https://ext-access-heco.azurewebsites.net";
const API_BASE = "https://outagemap-api-heco.azurewebsites.net";
const TOKEN_TTL_MS = 110 * 60 * 1000; // HECO tokens live ~120 min; refresh a little early
let _tokenCache = { token: null, exp: 0 };

async function mintToken(key) {
  if (_tokenCache.token && Date.now() < _tokenCache.exp) return _tokenCache.token;
  // TODO(verify): exact route/shape of the External Access Key Service is not publicly discoverable.
  const r = await fetch(`${ACCESS_BASE}/api/v1/accesskey`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`heco access-key service -> ${r.status}`);
  const j = await r.json();
  const token = j.token || j.accessToken || j.access_token;
  if (!token) throw new Error("heco: no token in access-key response");
  _tokenCache = { token, exp: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function fetchOutages(key, company) {
  const token = await mintToken(key);
  // TODO(verify): the live app sends an `extent` + `spatialReference` body; a full-state extent returns all.
  const r = await fetch(`${API_BASE}/api/v1/outages`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "X-Company": company, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`heco /outages -> ${r.status}`);
  return r.json();
}

// Generic serverless fetch handler (Workers-style). Returns the raw HECO payload for adapters/heco.mjs.
export default {
  async fetch(request, env = {}) {
    const key = env.HECO_ACCESS_KEY || (typeof process !== "undefined" && process.env && process.env.HECO_ACCESS_KEY);
    const cors = { "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*", "Content-Type": "application/json" };
    if (!key) {
      return new Response(JSON.stringify({ error: "disabled", reason: "HECO_ACCESS_KEY not configured" }), { status: 501, headers: cors });
    }
    try {
      const data = await fetchOutages(key, env.HECO_COMPANY || "HECO");
      return new Response(JSON.stringify(data), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: "upstream", reason: String(e.message) }), { status: 502, headers: cors });
    }
  },
};

// Also callable directly by the collector (server-side, no CORS concern).
export async function fetchHecoRaw(key, company = "HECO") {
  if (!key) throw new Error("heco: missing access key");
  return fetchOutages(key, company);
}
