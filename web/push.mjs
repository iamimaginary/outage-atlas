// Client Web Push enrollment (replaces the email capture). Renders a "Notify me" control for the
// resolved area; on tap: request permission, subscribe with the VAPID applicationServerKey, stash
// {fips,area,areaPath} in IndexedDB (so the service worker can build the notification), and POST the
// subscription to /api/push-subscribe. Dependency-free, browser-only.
const cfg = () => (typeof window !== "undefined" && window.OUTAGE_CONFIG) || {};
const ENDPOINT = () => cfg().pushSubscribeEndpoint || "/api/push-subscribe";
const VAPID = () => cfg().vapidPublicKey || "";

// base64url → Uint8Array (applicationServerKey; the byte form is the most compatible across browsers)
function b64urlToU8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// tiny IndexedDB kv (localStorage isn't readable from a service worker; Cache API is for Req/Res)
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("outage-atlas", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function subscribe(ctx) {
  if (!VAPID()) throw new Error("not-configured");
  await navigator.serviceWorker.register("/sw.js").catch(() => {}); // ensure SW exists (e.g. deep-linked area page)
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToU8(VAPID()) });
  await idbSet("alertPrefs", { fips: ctx.fips, area: ctx.area, areaPath: ctx.areaPath || "/" });
  const r = await fetch(ENDPOINT(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), fips: ctx.fips, area: ctx.area }) });
  if (!r.ok) throw new Error("save-failed:" + r.status);
}

// Render the alerts control into `container` for a resolved area. ctx: { fips, area, areaPath }.
export function renderPushControl(container, ctx = {}) {
  if (!container) return;
  container.hidden = false;
  const panel = (inner) => { container.innerHTML = `<div class="panel">${inner}</div>`; };

  if (!pushSupported()) {
    // iOS/iPadOS only allows Web Push from an installed PWA — guide the user there.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent))
      panel(`<b>🔔 Get outage alerts</b><div class="small muted" style="margin-top:4px">On iPhone/iPad: tap <b>Share</b> → <b>Add to Home Screen</b>, then open Outage Atlas from the home screen to turn on alerts.</div>`);
    else panel(`<b>🔔 Outage alerts</b><div class="small muted" style="margin-top:4px">Your browser doesn't support push notifications.</div>`);
    return;
  }
  if (!VAPID()) { panel(`<b>🔔 Outage alerts</b><div class="small muted" style="margin-top:4px">Alerts aren't enabled yet — check back soon.</div>`); return; }

  const denied = Notification.permission === "denied";
  panel(`<b>🔔 Alert me when ${ctx.area || "my area"} loses power</b>
    <div class="small muted" style="margin-top:4px">A push the moment an outage is detected here — and an all-clear when it's over. No email, no tracking.</div>
    <div style="margin-top:8px"><button class="lg-btn primary" id="oa-push">Notify me</button></div>
    <div class="small" id="oa-push-msg" style="margin-top:6px">${denied ? "Notifications are blocked — enable them in your browser settings." : ""}</div>`);
  const btn = container.querySelector("#oa-push"), msg = container.querySelector("#oa-push-msg");
  if (denied) { btn.disabled = true; return; }
  btn.onclick = async () => {
    btn.disabled = true; msg.style.color = "var(--mut,#9da7b3)"; msg.textContent = "Enabling…";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { msg.style.color = "var(--warn,#d29922)"; msg.textContent = "Permission not granted."; btn.disabled = false; return; }
      await subscribe(ctx);
      msg.style.color = "var(--ok,#3fb950)"; msg.textContent = `You're set — we'll alert you for ${ctx.area || "this area"}.`;
    } catch (e) {
      msg.style.color = "var(--warn,#d29922)";
      msg.textContent = e.message === "not-configured" ? "Alerts aren't enabled yet — check back soon." : "Couldn't enable alerts. Please try again.";
      btn.disabled = false;
    }
  };
}
