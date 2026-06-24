// Shared loader: read JSON from a local path or an http(s) URL. Used by the audit scripts so they can
// run against a local collector output OR the deployed snapshot on the tracker-data branch.
import { readFileSync } from "node:fs";

export async function loadJson(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`fetch ${src} -> ${r.status}`);
    return r.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}
