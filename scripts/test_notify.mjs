// Push-alert matcher tests: the PURE FIPS-join that maps per-area events to subscriber endpoints.
// deliverPush is env-gated + network, so it's not exercised here. No network. Exits non-zero on fail.
import { matchSubscribers } from "../poster/notify.mjs";

let fails = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); fails++; } };

const areaEvents = [
  { type: "onset", fips: "39035", name: "Cuyahoga, OH", out: 12000 },
  { type: "escalation", fips: "39035", name: "Cuyahoga, OH", out: 30000, band: 25000 },
  { type: "restored", fips: "42003", name: "Allegheny, PA", out: 0, peak: 9000 },
];
const subs = [
  { endpoint: "https://fcm.googleapis.com/fcm/send/AAA", fips: "39035" },
  { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/BBB", fips: "39035" },
  { endpoint: "https://web.push.apple.com/CCC", fips: "42003" },
  { endpoint: "https://fcm.googleapis.com/fcm/send/DDD", fips: "06075" }, // no matching event
  { endpoint: "", fips: "39035" }, // junk, ignored
];

console.log("matcher:");
{
  const m = matchSubscribers(areaEvents, subs); // default types: onset, escalation, restored
  ok(m.length === 5, `2 Cuyahoga subs × (onset+escalation) + 1 Allegheny restored = 5 (got ${m.length})`);
  ok(m.every((x) => x.endpoint), "junk endpoints skipped");
  ok(!m.some((x) => x.endpoint.endsWith("DDD")), "a subscriber with no active event gets nothing");
  ok(m.some((x) => x.endpoint.endsWith("CCC") && x.event.type === "restored"), "restored (all-clear) is matched");
  const onlyOnset = matchSubscribers(areaEvents, subs, ["onset"]);
  ok(onlyOnset.length === 2 && onlyOnset.every((x) => x.event.type === "onset"), "type filter narrows to onset only");
}

if (fails) { console.error(`\n${fails} notify test(s) FAILED`); process.exit(1); }
console.log("\nall notify tests passed");
