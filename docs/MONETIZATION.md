# Lead-gen monetization (Phase 6)

The LAST phase — turned on only after the audience engine (Phases 2–5) is producing traffic + a list.
A reusable CTA reads each area's state and shows the right offer, **below** the outage info, never
gating it.

## Variants (keyed to area state)

`web/leadgen.mjs` `classifyArea(county, alerts, grade)` → one of:

- **acute** — currently out *with* an active NWS weather alert (storm-driven) → **portable-power
  affiliate links** (EcoFlow + Jackery) with an FTC disclosure.
- **chronic** — a **blue-sky outage** (out with *no* active weather alert = a reliability red flag) or
  a **D/F reliability grade** → **"free whole-home backup quote" lead form** → `/api/lead`.
- **none** — no outage / good grade → renders nothing.

> Data note (from the Phase-1 finding): ODIN has no reliability grade, so "chronic" is driven by the
> **blue-sky** signal (computable from `baseline.alertsByFips`) today; pass a `grade` when a reliability
> layer is ported from NEO to enable true D/F targeting.

## Pieces

| File | Role |
|---|---|
| `web/leadgen.mjs` | PURE `classifyArea` (unit-tested, `scripts/test_leadgen.mjs`) + `renderCTA(container, ctx)`. Used by the app (`index.html`) and the SEO area pages (inline module). |
| `config.js` | Public runtime config: affiliate URLs + `leadEndpoint`. Affiliate IDs are public (in the link) → config, not secrets. |
| `workers/lead.mjs` | Serverless lead intake: validate + honeypot + rate-limit → **forward** to `LEAD_WEBHOOK_URL`. Stores/logs no PII (guardrail). Deploy at `/api/lead`. |

## Compliance (built in)

- **FTC**: affiliate disclosure sits next to the affiliate buttons ("we may earn a commission at no cost to you").
- **"Unofficial / not affiliated with any utility"** on every monetized surface (both variants + page footers).
- **Never interstitial / never gates outage info** — the CTA is a panel below the status, hidden when `none`.
- **PII**: the lead worker forwards to the operator webhook and neither stores nor logs the payload.

## Going live (operator)

1. Join EcoFlow + Jackery affiliate programs → put your tracking URLs in `config.js` `affiliates`
   (unset falls back to the plain storefront — functional but untracked).
2. Stand up a lead destination (Generac dealer CRM / Zapier / 33 Mile Radius / Modernize) → deploy
   `workers/lead.mjs` at `/api/lead` with env `LEAD_WEBHOOK_URL` (+ optional `LEADS_KV`, `ALLOW_ORIGIN`).
   Until set, the form returns a friendly "not enabled yet".
