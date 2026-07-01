// Host routing for the two faces of this Pages project:
//   • outageatlas.com        → the public app (admin surface is HIDDEN here: /admin* returns 404).
//   • admin.outageatlas.com  → the admin portal (protected at the edge by Cloudflare Access). Its root
//                               "/" serves the portal SPA at /admin/.
//
// The admin API (workers/admin.mjs) independently verifies the Access JWT, so this middleware is only
// UX/hygiene (hide the portal UI from the public host) — not the security boundary.
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const isAdminHost = url.hostname.startsWith("admin.");

  if (isAdminHost) {
    if (url.pathname === "/") return Response.redirect(url.origin + "/admin/", 302);
    return next();
  }

  // public host: the admin portal UI must not be served here
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return new Response("Not found", { status: 404 });
  }
  return next();
}
