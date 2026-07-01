// Auto-poster tests (handoff §2.7): facet byte-ranges, templates, and — the important one — a REPLAY
// test that feeds a full storm's snapshot sequence through the pure pipeline and asserts a major storm
// produces a HANDFUL of posts over its life, not one per 15-min tick. No network. Exits non-zero on fail.
import { detectEvents, selectToPost, commitPost } from "../poster/detect.mjs";
import { renderPost } from "../poster/templates.mjs";
import { detectFacets, graphemeLen } from "../poster/facets.mjs";

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log("  ✓ " + msg); else { console.error("  ✗ " + msg); fails++; } };

// deterministic clock
const T0 = 1_700_000_000_000, STEP = 15 * 60_000;

// one collector cycle: detect -> select -> commit the selected (emulates a successful LIVE run)
function step(state, counties, tick, hour = 12) {
  const now = T0 + tick * STEP;
  const { events, state: s1 } = detectEvents(state, { counties }, now);
  const selected = selectToPost(events, s1, now, hour);
  let s2 = s1;
  for (const e of selected) s2 = commitPost(s2, e, now);
  return { events, selected, state: s2, now };
}
const cty = (out) => ({ "39035": { fips: "39035", county: "Cuyahoga", state: "OH", out } });

console.log("facets:");
{
  const f = detectFacets("Live map: https://outageatlas.com/outage/oh/cuyahoga #ohwx");
  ok(f.length === 2, "detects one link + one hashtag");
  const link = f.find((x) => x.features[0].$type.endsWith("#link"));
  ok(link && link.features[0].uri === "https://outageatlas.com/outage/oh/cuyahoga", "link uri parsed");
  // byte vs char divergence: an emoji (4 bytes, 2 UTF-16 units) before the URL must shift byteStart
  const g = detectFacets("⚡ https://x.com");
  const bs = g[0].index.byteStart;
  ok(bs === Buffer.byteLength("⚡ ", "utf8"), `byte offset accounts for multibyte emoji (got ${bs}, want ${Buffer.byteLength("⚡ ", "utf8")})`);
  const tag = detectFacets("storm #CLEwx now")[0];
  ok(tag.features[0].tag === "CLEwx", "hashtag tag stripped of #");
}

console.log("templates:");
{
  const onset = renderPost({ type: "onset", name: "Cuyahoga, OH", state: "OH", out: 12345, at: "3:00 PM EDT" }, { url: "https://outageatlas.com/outage/oh/cuyahoga" });
  ok(onset.text.includes("12,345"), "onset has comma-formatted count");
  ok(onset.text.includes("⚡"), "onset has the ⚡ marker");
  ok(onset.text.includes("#ohwx"), "onset appends the derived weather hashtag");
  ok(graphemeLen(onset.text) <= 300, "onset within the 300-grapheme limit");
  const restored = renderPost({ type: "restored", name: "Cuyahoga, OH", state: "OH", out: 300, peak: 62000, at: "" }, { url: "https://x/y" });
  ok(restored.text.includes("✅") && restored.text.includes("62,000"), "restored shows peak");
  // a pathologically long name must still clamp to <=300
  const long = renderPost({ type: "onset", name: "X".repeat(400), state: "OH", out: 1, at: "now" }, { url: "https://x/y" });
  ok(graphemeLen(long.text) <= 300, "over-long post is hard-clamped");
}

console.log("detect — latching & significance:");
{
  let s = {};
  let r = step(s, cty(500), 0); s = r.state;   // below ABS_FLOOR
  ok(r.events.length === 0, "sub-floor outage produces no event");
  r = step(s, cty(1500), 1); s = r.state;      // onset
  ok(r.events.filter((e) => e.type === "onset").length === 1, "onset fires when it crosses the floor");
  r = step(s, cty(1600), 2); s = r.state;      // still ongoing, same band
  ok(r.events.length === 0, "onset latches — no re-onset next run at the same band");
}

console.log("detect — restored needs consecutive clear runs (debounce):");
{
  let s = {};
  let r = step(s, cty(20000), 1); s = r.state;          // onset, peak 20000, clear threshold = 2000
  r = step(s, cty(1500), 2); s = r.state;               // below threshold once
  ok(!r.events.some((e) => e.type === "restored"), "one dip does not fire restored");
  r = step(s, cty(1500), 3); s = r.state;               // second consecutive -> restored
  ok(r.events.some((e) => e.type === "restored"), "restored fires after CLEAR_RUNS consecutive clears");
}

console.log("replay — a full major storm over 14 ticks:");
{
  let s = {};
  const seq = [200, 1500, 4000, 7000, 15000, 30000, 60000, 62000, 55000, 40000, 20000, 8000, 5000, 2000];
  const counts = { onset: 0, escalation: 0, restored: 0, rollup: 0 };
  let totalPosts = 0;
  seq.forEach((out, i) => {
    const r = step(s, cty(out), i);
    s = r.state;
    for (const e of r.selected) { counts[e.type]++; totalPosts++; }
  });
  // then the county drops out of ODIN entirely (recovered) — restored must still resolve if not already
  console.log(`    posts over ${seq.length} ticks: ${JSON.stringify(counts)} (total ${totalPosts})`);
  ok(counts.onset === 1, "exactly one onset for the storm");
  ok(counts.restored === 1, "exactly one restored for the storm");
  ok(totalPosts >= 2 && totalPosts <= 6, `a major storm yields a handful of posts, not one per tick (${totalPosts} over ${seq.length})`);
}

console.log("regional roll-up (anti-spam keystone):");
{
  const counties = {};
  for (let i = 0; i < 6; i++) counties[`3900${i}`] = { fips: `3900${i}`, county: `C${i}`, state: "OH", out: 5000 };
  const { events, state } = detectEvents({}, { counties }, T0);
  ok(events.filter((e) => e.type === "onset").length === 0, "individual onsets suppressed when many fire at once");
  ok(events.filter((e) => e.type === "rollup").length === 1, "exactly one regional roll-up emitted");
  const roll = events.find((e) => e.type === "rollup");
  ok(roll.count === 6 && roll.sumOut === 30000, "roll-up aggregates count + total out");
  ok(Object.keys(state).filter((k) => k !== "_global").every((k) => state[k].phase === "ongoing"), "all areas still latched despite suppressed posts");
}

console.log("throttle — quiet hours suppress minor escalations, not majors:");
{
  const minor = { type: "escalation", fips: "1", band: 5000, out: 6000, event_id: "e" };
  const major = { type: "onset", fips: "2", band: 50000, out: 60000, event_id: "o" };
  const st = { _global: { recent_post_times: [], posted_keys: [] } };
  const night = selectToPost([minor, major], st, T0, 2);   // 2am
  ok(!night.includes(minor) && night.includes(major), "at 2am: minor escalation held, major onset posts");
  const day = selectToPost([minor, major], st, T0, 14);    // 2pm
  ok(day.includes(minor) && day.includes(major), "at 2pm: both post");
}

console.log("throttle — global hourly cap:");
{
  const evs = Array.from({ length: 10 }, (_, i) => ({ type: "onset", fips: `f${i}`, out: 1000 * (i + 1), event_id: `e${i}` }));
  const sel = selectToPost(evs, { _global: { recent_post_times: [], posted_keys: [] } }, T0, 12);
  ok(sel.length === 6, `global cap limits to 6/hr (got ${sel.length})`);
  ok(sel[0].out >= sel[sel.length - 1].out, "cap keeps the biggest outages (ranked by customers out)");
}

if (fails) { console.error(`\n${fails} poster test(s) FAILED`); process.exit(1); }
console.log("\nall poster tests passed");
