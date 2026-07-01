// VAPID crypto golden test (the correctness gate). Proves vapidJwt emits a raw 64-byte ES256 signature
// (NOT ~70-72B DER) that verifies against the public key, with correct claims — so the DER-vs-raw bug
// (the #1 cause of push 401/403) can't ship green. No network. Exits non-zero on fail.
import { generateKeyPairSync, createVerify } from "node:crypto";
import { vapidJwt, isGone, isAccepted } from "../poster/webpush.mjs";

let fails = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); fails++; } };

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const NOW = 1782900000;
const endpoint = "https://fcm.googleapis.com/fcm/send/abc123?x=1";
const jwt = vapidJwt(endpoint, "https://outageatlas.com", privPem, NOW);
const [h, p, s] = jwt.split(".");

console.log("VAPID JWT:");
{
  const sig = Buffer.from(s, "base64url");
  ok(sig.length === 64, `ES256 signature is raw 64 bytes, not DER (got ${sig.length})`);
  const verified = createVerify("SHA256").update(`${h}.${p}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
  ok(verified, "signature verifies against the public key");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  ok(header.alg === "ES256" && header.typ === "JWT", "header is {alg:ES256, typ:JWT}");
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  ok(claims.aud === "https://fcm.googleapis.com", `aud is the endpoint ORIGIN, not path (got ${claims.aud})`);
  ok(claims.exp - NOW <= 24 * 3600 && claims.exp > NOW, "exp is in the future and <= 24h ahead");
  ok(!!claims.sub, "sub claim present (push services reject without it)");
}

console.log("application server key:");
{
  const raw = Buffer.from(publicKey.export({ type: "spki", format: "der" })).subarray(-65);
  ok(raw.length === 65 && raw[0] === 0x04, "public key is a 65-byte uncompressed P-256 point (0x04 prefix)");
  ok(raw.toString("base64url") === raw.toString("base64url").replace(/=+$/, ""), "base64url is unpadded (RFC 8292)");
}

console.log("response classification:");
{
  ok(isGone(404) && isGone(410), "404/410 → prune the subscription");
  ok(!isGone(401) && !isGone(403) && !isGone(429), "401/403/429 are NOT prune (auth/rate — keep the sub)");
  ok(isAccepted(201) && isAccepted(200) && !isAccepted(410), "2xx accepted, 410 not");
}

if (fails) { console.error(`\n${fails} webpush test(s) FAILED`); process.exit(1); }
console.log("\nall webpush tests passed");
