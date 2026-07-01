// Display-ad injection, isolated in ONE module so the ad vendor's origins live in a single place —
// mirrored in index.html's CSP and validated by scripts/audit_csp.mjs. No-op unless the operator has
// enabled an ad provider in the admin portal (settings.ads). Today: Google AdSense.
//
// Security posture: with provider "none" (the default) NO third-party script loads at all — the CSP
// allowlists Google's ad origins but nothing uses them. Only when an operator explicitly enables AdSense
// (admin.outageatlas.com → Settings) does adsbygoogle.js load. See docs/ADMIN.md for the tradeoff.

// The ad-vendor origins that must be present in the page CSP for AdSense to work. Kept here as the single
// source of truth; audit_csp.mjs cross-checks that each is actually allowlisted.
export const AD_ORIGINS = [
  "https://pagead2.googlesyndication.com",   // adsbygoogle.js (script) + beacons (connect/img)
  "https://googleads.g.doubleclick.net",     // ad iframes (frame) + connect
  "https://tpc.googlesyndication.com",        // ad iframes (frame) + creatives (img)
];

// Mount an AdSense responsive unit into `container`. Returns true if an ad was mounted.
export function mountAds(ads, container) {
  if (!container) return false;
  if (!ads || !ads.enabled || ads.provider !== "adsense" || !ads.clientId) {
    container.classList.add("hide");
    return false;
  }
  container.classList.remove("hide");
  // load the library once
  if (!document.getElementById("adsense-lib")) {
    const s = document.createElement("script");
    s.id = "adsense-lib";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ads.clientId);
    document.head.appendChild(s);
  }
  // (re)build the ad unit
  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.setAttribute("data-ad-client", ads.clientId);
  if (ads.slot) ins.setAttribute("data-ad-slot", ads.slot);
  ins.setAttribute("data-ad-format", "auto");
  ins.setAttribute("data-full-width-responsive", "true");
  container.innerHTML = "";
  container.appendChild(ins);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked / not ready */ }
  return true;
}
