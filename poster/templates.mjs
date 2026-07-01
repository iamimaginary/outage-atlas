// Post copy (handoff §2.4) — pure text builders. Detection/orchestration decide WHAT/ WHEN; this only
// decides how an event reads. Kept ≤300 graphemes (Bluesky) by trimming the optional cause. Adds a
// derived local weather hashtag (#<st>wx — a real convention local weather-watchers follow) for reach.
import { graphemeLen } from "./facets.mjs";

const commas = (x) => Number(x || 0).toLocaleString("en-US");
const wxTag = (st) => (st && /^[A-Za-z]{2}$/.test(st) ? ` #${st.toLowerCase()}wx` : "");
const causePart = (c) => (c ? ` ${String(c).replace(/\s+/g, " ").trim()}.` : "");

// event: { type, name, state, out, delta?, peak?, at, since?, count?, sumOut?, cause? }
// opts:  { url }  -> the area's SEO page (Phase 4) or the app deep-linked to the area.
// Returns { text, link } (link kept separate so a platform can render it as a card/embed).
export function renderPost(event, { url }) {
  const st = event.state || "";
  const area = event.name || "your area";
  let text;

  switch (event.type) {
    case "onset":
      text = `⚡ Power outage: ${commas(event.out)} customers out in ${area} as of ${event.at}.${causePart(event.cause)} Live map: ${url}${wxTag(st)}`;
      // if too long, drop the cause clause first
      if (graphemeLen(text) > 300)
        text = `⚡ Power outage: ${commas(event.out)} customers out in ${area} as of ${event.at}. Live map: ${url}${wxTag(st)}`;
      break;
    case "escalation":
      text = `📈 ${area} outage growing — now ${commas(event.out)} out (+${commas(event.delta)} since ${event.since}). ${url}${wxTag(st)}`;
      break;
    case "restored":
      text = `✅ Power mostly restored in ${area} — down to ${commas(event.out)} from a peak of ${commas(event.peak)}. ${url}${wxTag(st)}`;
      break;
    case "rollup":
      text = `⚠️ ${commas(event.sumOut)} customers without power across ${event.count} counties${st ? ` in ${st}` : ""} as of ${event.at}. Live map: ${url}${wxTag(st)}`;
      break;
    default:
      text = `${area}: ${commas(event.out)} out. ${url}`;
  }

  // hard safety clamp (should never trigger for our templates, but never emit an over-limit post)
  if (graphemeLen(text) > 300) text = [...text].slice(0, 297).join("") + "…";
  return { text, link: url };
}
