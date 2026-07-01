// Lead-gen / monetization component (handoff Phase 6) — the LAST phase, reads an area's state and shows
// the right offer. Two variants, keyed to the reliability signal:
//   • acute   (area out during a storm)      -> portable-power AFFILIATE links (EcoFlow/Jackery) + FTC note
//   • chronic (blue-sky outage, or D/F grade) -> "free whole-home backup quote" LEAD FORM -> webhook
// Never interstitial, never gates outage info — this renders BELOW the status. Shared by the main app
// (module import) and the generated SEO area pages (inline module). classifyArea is pure + unit-tested.
//
// Config is read from window.OUTAGE_CONFIG (see /config.js) — affiliate URLs + lead endpoint. Affiliate
// IDs are public (they live in the link), so they're config, not secrets; the lead webhook IS a secret
// and lives server-side in workers/lead.mjs.

// Pure classifier. `alerts` = active NWS alert events for the area (from baseline.alertsByFips[fips]);
// `grade` = optional reliability grade (A–F) if a reliability layer is ever supplied.
export function classifyArea(county, alerts, grade) {
  const out = county && county.out > 0 ? county.out : 0;
  if (grade && /[DF]/i.test(grade)) return "chronic";       // graded poor reliability
  if (out > 0 && (!alerts || alerts.length === 0)) return "chronic"; // blue-sky outage = reliability flag
  if (out > 0) return "acute";                               // storm-driven outage happening now
  return "none";
}

const cfg = () => (typeof window !== "undefined" && window.OUTAGE_CONFIG) || {};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DEFAULT_AFFILIATES = {
  ecoflow: "https://www.ecoflow.com/us/portable-power-stations",
  jackery: "https://www.jackery.com/collections/portable-power-stations",
};

// Render the CTA into `container`. ctx: { county, area, fips, zip, alerts, grade }.
// Returns the chosen variant (or "none" — container is cleared/hidden).
export function renderCTA(container, ctx = {}) {
  if (!container) return "none";
  const c = cfg();
  const variant = classifyArea(ctx.county, ctx.alerts, ctx.grade);
  if (variant === "none") { container.innerHTML = ""; container.hidden = true; return "none"; }
  container.hidden = false;

  if (variant === "acute") {
    const aff = Object.assign({}, DEFAULT_AFFILIATES, c.affiliates || {});
    container.innerHTML =
      `<div class="panel lg-acute">
        <div><b>Keep your fridge, internet & medical devices running</b></div>
        <div class="small" style="margin-top:4px;color:var(--mut,#9da7b3)">Portable power stations can keep essentials on during an outage in ${esc(ctx.area || "your area")}.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <a class="lg-btn" target="_blank" rel="sponsored noopener" href="${esc(aff.ecoflow)}">EcoFlow ›</a>
          <a class="lg-btn" target="_blank" rel="sponsored noopener" href="${esc(aff.jackery)}">Jackery ›</a>
        </div>
        <div class="small" style="margin-top:8px;color:var(--mut,#9da7b3)">Affiliate links — we may earn a commission at no cost to you. Not affiliated with any utility.</div>
      </div>`;
    return "acute";
  }

  // chronic -> lead form
  const endpoint = c.leadEndpoint || "/api/lead";
  container.innerHTML =
    `<div class="panel lg-chronic">
      <div><b>This area loses power even in clear weather</b></div>
      <div class="small" style="margin-top:4px;color:var(--mut,#9da7b3)">A whole-home backup generator keeps ${esc(ctx.area || "your home")} running through outages. Get a free, no-obligation quote from a local installer.</div>
      <form class="lg-form" style="margin-top:10px;display:grid;gap:8px" novalidate>
        <input name="name" placeholder="Name" autocomplete="name" required>
        <input name="zip" placeholder="ZIP" inputmode="numeric" autocomplete="postal-code" value="${esc(ctx.zip || "")}" required>
        <input name="phone" placeholder="Phone" inputmode="tel" autocomplete="tel" required>
        <select name="type"><option value="whole-home">Whole-home backup</option><option value="portable">Portable / partial</option></select>
        <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
        <button class="lg-btn primary" type="submit">Get my free quote ›</button>
      </form>
      <div class="small lg-msg" style="margin-top:6px"></div>
      <div class="small" style="margin-top:4px;color:var(--mut,#9da7b3)">We share your details only with a matched local installer. No trackers. Not affiliated with any utility.</div>
    </div>`;

  const form = container.querySelector(".lg-form");
  const msg = container.querySelector(".lg-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const payload = { name: (f.get("name") || "").trim(), zip: (f.get("zip") || "").trim(), phone: (f.get("phone") || "").trim(), type: f.get("type"), area: ctx.area || "", fips: ctx.fips || "", hp: f.get("company") };
    if (!payload.name || !/^\d{5}$/.test(payload.zip) || payload.phone.replace(/\D/g, "").length < 10) { msg.style.color = "var(--warn,#d29922)"; msg.textContent = "Please enter your name, a 5-digit ZIP, and a valid phone."; return; }
    const btn = form.querySelector("button"); btn.disabled = true; msg.style.color = "var(--mut,#9da7b3)"; msg.textContent = "Sending…";
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { msg.style.color = "var(--ok,#3fb950)"; msg.textContent = "Thanks — a local installer will reach out with your free quote."; form.reset(); }
      else if (r.status === 503) { msg.style.color = "var(--warn,#d29922)"; msg.textContent = "Quotes aren't enabled yet — check back soon."; }
      else { msg.style.color = "var(--warn,#d29922)"; msg.textContent = "Couldn't send that right now. Please try again later."; }
    } catch { msg.style.color = "var(--warn,#d29922)"; msg.textContent = "Couldn't reach the server. Please try again later."; }
    finally { btn.disabled = false; }
  });
  return "chronic";
}
