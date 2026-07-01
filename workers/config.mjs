// Public runtime config — served at the SITE ORIGIN path `/api/config`. The page fetches this to get
// the CURRENT editable settings (ad provider, affiliate links, feature flags, announcement banner) so
// the operator can change them from the admin portal WITHOUT a code deploy. Everything returned here is
// already public (affiliate ids live in outbound links; ad ids are public). Falls back to the static
// config.js baked defaults if the DB binding/settings row is absent.
//
// Cached briefly at the edge so it doesn't hit D1 on every pageview.

import { getSettings, publicSettings } from "./lib/db.mjs";

export default {
  async fetch(request, env = {}) {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    let settings;
    try {
      settings = env.ANALYTICS_DB ? publicSettings(await getSettings(env.ANALYTICS_DB)) : publicSettings({});
    } catch {
      settings = publicSettings({});
    }
    return new Response(JSON.stringify(settings), { status: 200, headers });
  },
};
