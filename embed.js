// Outage Atlas embed loader (handoff Phase 5) — convenience over the /embed/ iframe. A third-party site
// drops ONE script + a placeholder div and gets a live, auto-refreshing area status widget:
//
//   <div class="outage-atlas-embed" data-fips="39035" data-name="Cuyahoga, OH"></div>
//   <script src="https://outageatlas.com/embed.js" async></script>
//
// Optional data-* : data-theme="light", data-width, data-height. Pure, dependency-free.
(function () {
  var BASE = "https://outageatlas.com/embed/";
  function build(el) {
    if (el.getAttribute("data-oa-done")) return;
    el.setAttribute("data-oa-done", "1");
    var fips = (el.getAttribute("data-fips") || "").replace(/[^0-9]/g, "").slice(0, 5);
    if (!fips) return;
    var q = "?fips=" + fips;
    if (el.getAttribute("data-name")) q += "&name=" + encodeURIComponent(el.getAttribute("data-name"));
    if (el.getAttribute("data-theme")) q += "&theme=" + encodeURIComponent(el.getAttribute("data-theme"));
    var f = document.createElement("iframe");
    f.src = BASE + q;
    f.title = "Live outage status — Outage Atlas";
    f.loading = "lazy";
    f.setAttribute("scrolling", "no");
    f.style.cssText = "border:0;width:" + (el.getAttribute("data-width") || "320px") + ";height:" + (el.getAttribute("data-height") || "160px") + ";max-width:100%";
    el.appendChild(f);
  }
  function run() { var els = document.querySelectorAll(".outage-atlas-embed"); for (var i = 0; i < els.length; i++) build(els[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
