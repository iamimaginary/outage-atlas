// Bluesky rich-text facets — pure, dependency-free, golden-tested.
//
// Bluesky does NOT auto-linkify: clickable links + hashtags need `facets` with BYTE ranges over the
// post's UTF-8 encoding (index.byteStart/byteEnd), each with a feature (#link or #tag). The handoff
// (§2.5) suggests @atproto/api's RichText to avoid hand-rolling this — but this repo is strictly
// dependency-free / no-build (a hard ground rule), and pure+tested modules are the house style. So we
// hand-roll it here and guard it with unit tests (scripts/test_poster.mjs). The #1 gotcha is byte vs
// JS-string indices: emoji/accents make them diverge, so we always measure with TextEncoder.
//
// detectFacets(text) -> [ { index:{byteStart,byteEnd}, features:[ {$type, uri|tag} ] } ]

const enc = new TextEncoder();
const blen = (s) => enc.encode(s).length; // UTF-8 byte length

// URLs: http(s)://…, stopping before trailing punctuation that's usually not part of the link.
const URL_RE = /https?:\/\/[^\s]+/g;
// Hashtags: #word after start/whitespace; letters/digits/underscore, must contain a non-digit.
const TAG_RE = /(^|\s)(#[^\d\s#][^\s#]*)/g;

function trimUrl(u) {
  // drop trailing sentence punctuation (Bluesky's detector does the same); keep balanced ")".
  let end = u.length;
  while (end > 0 && ".,;:!?".includes(u[end - 1])) end--;
  if (u[end - 1] === ")" && !u.slice(0, end).includes("(")) end--;
  return u.slice(0, end);
}

export function detectFacets(text) {
  const facets = [];

  for (const m of text.matchAll(URL_RE)) {
    const uri = trimUrl(m[0]);
    const byteStart = blen(text.slice(0, m.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + blen(uri) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri }],
    });
  }

  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[2].slice(1); // strip the leading '#'
    const at = m.index + m[1].length; // skip the leading whitespace captured in group 1
    const byteStart = blen(text.slice(0, at));
    facets.push({
      index: { byteStart, byteEnd: byteStart + blen(m[2]) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }

  // Bluesky wants facets in ascending byteStart order.
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

// Grapheme-ish length for the ≤300 limit. Bluesky counts graphemes; without Intl.Segmenter we
// approximate with code points (spread), which is exact for our ASCII+emoji templates.
export function graphemeLen(text) {
  return [...text].length;
}
