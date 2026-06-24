// Auto-file a labeled GitHub issue for a scheduled-audit failure, so a maintenance agent can pick it up
// (the CLAUDE.md recurring jobs). Dedupes by a hidden signature: if an OPEN issue with that signature
// already exists, it does nothing (no spam); otherwise it creates one. Sanitizes the body (no PII).
// Needs a token with issues:write (the workflow's GITHUB_TOKEN).

// strip anything that looks like PII before it ever reaches a public-ish issue
export function sanitize(text) {
  return String(text || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{1,5}\s+[A-Za-z0-9.\s]{3,40}\b(?:street|st|ave|avenue|road|rd|blvd|lane|ln|drive|dr)\b/gi, "[address]");
}

async function gh(repo, path, token, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "outage-atlas-audit" },
    ...opts
  });
  if (!r.ok) throw new Error(`GitHub API ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

export async function fileIssue({ repo, token, title, body, labels = [], signature }) {
  if (!repo || !token) throw new Error("fileIssue needs { repo, token }");
  const sig = signature || `<!-- oa-audit:${title} -->`;
  const open = await gh(repo, `/issues?state=open&per_page=100`, token);
  const existing = Array.isArray(open) ? open.find((i) => (i.body || "").includes(sig)) : null;
  if (existing) { console.log(`already tracked: issue #${existing.number} (${sig})`); return existing.number; }
  const fullBody = `${sanitize(body)}\n\n_Auto-filed by a scheduled audit. Resolve per CLAUDE.md, then close._\n${sig}`;
  const created = await gh(repo, `/issues`, token, { method: "POST", body: JSON.stringify({ title, body: fullBody, labels }) });
  console.log(`filed issue #${created.number}: ${title}`);
  return created.number;
}
