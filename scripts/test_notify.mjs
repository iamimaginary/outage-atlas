// Subscriber-alert tests (Phase 3): the PURE matcher that joins per-area events to subscribers by FIPS,
// and the alert copy. No network (deliverAlerts is env-gated and dry-runs by default). Exits non-zero on fail.
import { matchSubscribers, renderAlert } from "../poster/notify.mjs";

let fails = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { console.error("  ✗ " + m); fails++; } };

const areaEvents = [
  { type: "onset", fips: "39035", name: "Cuyahoga, OH", out: 12000 },
  { type: "escalation", fips: "39035", name: "Cuyahoga, OH", out: 30000, band: 25000 },
  { type: "restored", fips: "42003", name: "Allegheny, PA", out: 200, peak: 9000 },
];
const subs = [
  { email: "a@x.com", fips: "39035" },
  { email: "b@x.com", fips: "39035" },
  { email: "c@x.com", fips: "42003" },
  { email: "d@x.com", fips: "06075" }, // no matching event
  { email: "", fips: "39035" },        // junk, ignored
];

console.log("matcher:");
{
  const m = matchSubscribers(areaEvents, subs); // default types: onset, restored (NOT escalation)
  ok(m.length === 3, `two Cuyahoga onset + one Allegheny restored = 3 matches (got ${m.length})`);
  ok(m.every((x) => x.event.type !== "escalation"), "escalations excluded from email by default (too noisy)");
  ok(m.some((x) => x.email === "a@x.com" && x.event.type === "onset"), "matches a subscriber to their county's onset");
  ok(!m.some((x) => x.email === "d@x.com"), "a subscriber with no active event gets nothing");
  ok(!m.some((x) => x.email === ""), "junk subscribers are skipped");
  const withEsc = matchSubscribers(areaEvents, subs, ["onset", "escalation", "restored"]);
  ok(withEsc.length === 5, "opting escalations in yields all 5 matches");
}

console.log("copy:");
{
  const onset = renderAlert({ type: "onset", name: "Cuyahoga, OH", out: 12000 }, "https://outageatlas.com/outage/oh/cuyahoga");
  ok(/outage/i.test(onset.subject) && onset.text.includes("12,000"), "onset alert names the area + count");
  ok(/unsubscribe/i.test(onset.text) && /not affiliated/i.test(onset.text), "alert carries unsubscribe + unaffiliated notice");
  const done = renderAlert({ type: "restored", name: "Allegheny, PA", out: 200, peak: 9000 }, "https://x/y");
  ok(done.subject.includes("restored") && done.text.includes("9,000"), "restored alert shows the peak");
}

if (fails) { console.error(`\n${fails} notify test(s) FAILED`); process.exit(1); }
console.log("\nall notify tests passed");
