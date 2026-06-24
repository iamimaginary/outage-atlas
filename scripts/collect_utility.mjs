// Deep per-utility collector. Fetches one utility's deep feed via its adapter and writes the canonical
// snapshot + bounded history to the sharded data layer. Runs server-side (the collector can set Referer/
// Origin that browsers can't), so the page just reads the published snapshot.
//
//   node scripts/collect_utility.mjs <utilityId>     # default: firstenergy-oh
//
// Currently wires the Kübra 3-step chain (currentState -> configuration -> report.json). Other vendors
// get their own fetch branch keyed by config.adapter. Refuses to publish a structurally empty snapshot.
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getAdapter } from "../adapters/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2] || "firstenergy-oh";
const cfg = JSON.parse(readFileSync(join(ROOT, "utilities", `${id}.json`), "utf8"));
const reg = getAdapter(cfg.adapter);
if (!reg) throw new Error(`unknown adapter "${cfg.adapter}" for ${id}`);

const KB = "https://kubra.io";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const HIST_CAP = 1500;

async function jget(url, extra = {}) {
  const headers = { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", ...extra };
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (r.ok) return r.json();
      lastErr = new Error(`${url.split("/")[2]} ${r.status}`);
      if (!(r.status === 403 || r.status === 429 || r.status >= 500)) break;
    } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 700 * attempt + Math.random() * 400));
  }
  throw lastErr;
}

// Kübra: currentState -> configuration/{deploymentId} -> report.json -> parseKubraReport
async function fetchKubra(c) {
  const H = { Referer: c.referer, Origin: new URL(c.referer).origin };
  const cs = await jget(`${KB}/stormcenter/api/v1/stormcenters/${c.instance}/views/${c.view}/currentState?preview=false`, H);
  const dataPath = cs.data.interval_generation_data, dep = cs.stormcenterDeploymentId;
  const conf = await jget(`${KB}/stormcenter/api/v1/stormcenters/${c.instance}/views/${c.view}/configuration/${dep}?preview=false`, H);
  const reps = conf.config.reports.data.interval_generation_data;
  const src = (reps.find((r) => /report\.json$/i.test(r.source)) || reps[0]).source;
  return jget(`${KB}/${dataPath}/${src}`, H);
}

const FETCH = { kubra: fetchKubra };

(async () => {
  const fetcher = FETCH[cfg.adapter];
  if (!fetcher) throw new Error(`no deep fetcher implemented for adapter "${cfg.adapter}"`);
  const raw = await fetcher(cfg.config);
  const parser = reg.mod[reg.defaultFn];
  const { official, areas } = parser(raw);
  if (!areas.length) throw new Error("empty deep report (no areas) — refusing to publish");
  const collectedAt = Date.now();

  const snapshot = { schema: 1, id, name: cfg.name, adapter: cfg.adapter, collectedAt, official, areas };
  mkdirSync(join(ROOT, "data", "utilities"), { recursive: true });
  mkdirSync(join(ROOT, "data", "history"), { recursive: true });
  writeFileSync(join(ROOT, "data", "utilities", `${id}.json`), JSON.stringify(snapshot));

  // bounded history
  const histPath = join(ROOT, "data", "history", `${id}.json`);
  let hist = [];
  if (existsSync(histPath)) { try { hist = JSON.parse(readFileSync(histPath, "utf8")); } catch {} }
  hist.push({ t: collectedAt, out: official.out });
  while (hist.length > HIST_CAP) hist.shift();
  writeFileSync(histPath, JSON.stringify(hist));

  // refresh index.deep from the utility snapshots present (read-modify-write; preserve baseline fields)
  const idxPath = join(ROOT, "data", "national", "index.json");
  let idx = { schema: 1, baseline: {}, deep: {} };
  if (existsSync(idxPath)) { try { idx = JSON.parse(readFileSync(idxPath, "utf8")); } catch {} }
  idx.deep = idx.deep || {};
  const udir = join(ROOT, "data", "utilities");
  for (const f of readdirSync(udir).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(join(udir, f), "utf8"));
    const cfgPath = join(ROOT, "utilities", f);
    const ucfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
    idx.deep[s.id] = { name: s.name, match: ucfg.match || [], out: s.official.out, collectedAt: s.collectedAt };
  }
  mkdirSync(join(ROOT, "data", "national"), { recursive: true });
  writeFileSync(idxPath, JSON.stringify(idx, null, 2));

  const subs = areas.reduce((a, c) => a + c.subs.length, 0);
  console.log(`deep [${id}]: official ${official.out} out / ${official.served} served; ${areas.length} areas, ${subs} sub-areas; history ${hist.length} pts`);
})().catch((e) => { console.error(`collect_utility[${id}] FAILED:`, e.message); process.exit(1); });
