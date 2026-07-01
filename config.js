// Public runtime config for Outage Atlas monetization (Phase 6). Loaded by index.html + the SEO area
// pages. Affiliate IDs/URLs are PUBLIC (they live in the outbound link) so they belong here, not in
// secrets. The lead webhook is a SECRET and lives server-side in workers/lead.mjs — never put it here.
// Edit and commit.
window.OUTAGE_CONFIG = {
  // --- Web Push alerts ---
  // Public VAPID key (base64url, ~87 chars) from `node scripts/gen_vapid.mjs`. Public by design.
  // Leave "" until you generate it — the "Notify me" control shows "not enabled yet" until then.
  vapidPublicKey: "BBFIv5JkM_-LG8J8e4xzAjxBseas2SSWZS6OeK1A9vdb32RTYucfe7aXju_jcUw9i0n0DPCJTOdrV5VdJxZIn78",
  pushSubscribeEndpoint: "/api/push-subscribe",

  // Where the "free backup quote" lead form POSTs. Deploy workers/lead.mjs at this same-origin path.
  leadEndpoint: "/api/lead",
  // Full affiliate tracking URLs from each program (Impact / ShareASale / etc.). Unset = the plain
  // partner storefront (functional, just untracked). Start with EcoFlow + Jackery per the plan.
  affiliates: {
    // ecoflow: "https://your-ecoflow-affiliate-link",
    // jackery: "https://your-jackery-affiliate-link",
  },
};
