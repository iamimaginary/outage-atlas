// One-time VAPID keypair generator (offline, pure node:crypto). Run locally, paste the output into
// secrets/config — NEVER commit the private key.
//
//   node scripts/gen_vapid.mjs
//
// Output:
//   VAPID_PRIVATE_KEY  → GitHub Actions secret (the collector signs pushes with it)
//   VAPID_PUBLIC_KEY   → GitHub Actions var AND config.js window.OUTAGE_CONFIG.vapidPublicKey (public)
//   VAPID_SUBJECT      → use https://outageatlas.com (NOT a personal email — it's sent to push services)
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
// applicationServerKey = the raw 65-byte uncompressed point (0x04||X||Y) = last 65 bytes of the SPKI DER.
const pub = Buffer.from(publicKey.export({ type: "spki", format: "der" })).subarray(-65);
if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("unexpected public key encoding");
const pubB64url = pub.toString("base64url"); // unpadded — required by RFC 8292

console.log("=== VAPID keys — store securely, DO NOT commit the private key ===\n");
console.log("VAPID_PUBLIC_KEY (config.js + GH var):\n" + pubB64url + "\n");
console.log("VAPID_PRIVATE_KEY (GitHub Actions secret — PKCS8 PEM, keep the newlines):\n" + privPem + "\n");
console.log("VAPID_SUBJECT (GH var): https://outageatlas.com");
