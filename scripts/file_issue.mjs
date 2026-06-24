// CLI wrapper for lib/file_issue.mjs — used by the scheduled audit workflows. Reads the issue body from
// stdin (the failing audit's output) and files/dedupes a labeled issue.
//
//   node scripts/audit_X.mjs | node scripts/file_issue.mjs --title "…" --labels drift,adapter-broken --signature drift:odin
// Env: GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/repo — set automatically in Actions).
import { fileIssue } from "./lib/file_issue.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const title = opt("--title", "Audit failure");
const labels = (opt("--labels", "audit-failure") || "").split(",").map((s) => s.trim()).filter(Boolean);
const signature = `<!-- oa-audit:${opt("--signature", title)} -->`;
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (body += c));
process.stdin.on("end", async () => {
  if (!repo || !token) { console.error("file_issue: GITHUB_REPOSITORY and GITHUB_TOKEN required"); process.exit(1); }
  try {
    await fileIssue({ repo, token, title, body: "```\n" + body.slice(0, 4000) + "\n```", labels, signature });
  } catch (e) { console.error("file_issue failed:", e.message); process.exit(1); }
});
