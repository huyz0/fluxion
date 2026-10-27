#!/usr/bin/env node
// Pre-commit gate: the staged change must have a recorded `pass` verdict bound to its content identity.
// Bypass is impossible by design except through an explicit, reviewed exemption list below.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repoPath } from './lib.mjs';
import { contentId, parseDigest } from './review-content.mjs';

const diff = git(['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean);
if (diff.length === 0) process.exit(0);

// Exemption: commits that only touch loop bookkeeping. A backlog change qualifies only if it
// alters nothing but the State/Commit cells of existing rows — acceptance, task or requirement
// text is a spec change and needs a verdict (M0 cp1 F2).
const BOOKKEEPING = [/^\.harness\/(progress\.md|state\.json|reviews\/)/, /^docs\/backlog\/current\.md$/];
const BACKLOG = 'docs/backlog/current.md';
const STATE_COLS = [6, 7]; // | ID | Task | Req | Acceptance | Deps | State | Commit |  → split indices

function backlogOnlyStateChanges() {
  if (!diff.includes(BACKLOG)) return true;
  const before = git(['show', `HEAD:${BACKLOG}`]);
  const after = git(['show', `:${BACKLOG}`]);
  if (before.status !== 0 || after.status !== 0) return false;
  const rows = (text) => text.split(/\r?\n/).map((l) => l.split('|'));
  const a = rows(before.stdout);
  const b = rows(after.stdout);
  if (a.length !== b.length) return false;
  // Setting a row to `descoped` closes it without doing the work, so it is a scope decision that
  // always needs a verdict (M0 final F1) — never exempt bookkeeping.
  const toDescoped = b.some((cells, i) => /^\s*descoped\b/.test(cells[6] ?? '') && (a[i]?.[6] ?? '') !== cells[6]);
  if (toDescoped) return false;
  return a.every((cells, i) => cells.length === b[i].length && cells.every((c, j) => STATE_COLS.includes(j) || c === b[i][j]));
}

if (diff.every((p) => BOOKKEEPING.some((re) => re.test(p))) && backlogOnlyStateChanges()) {
  console.log('reviewed: bookkeeping-only commit (exempt)');
  process.exit(0);
}

// Bound to the rebase-stable content identity (ADR-0195), and the commit must carry its own
// tracked pass line: the digest is bookkeeping, so staging it leaves the identity unchanged.
const content = contentId();
if (!content) {
  console.log('reviewed: bookkeeping and generated reports only (exempt; check-api and check-trace verify reports)');
  process.exit(0);
}
const dir = repoPath('.harness', 'review');
const verdicts = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  : [];
const local = verdicts.find((v) => v.verdict === 'pass' && v.content_id === content);
const staged = git(['show', ':.harness/reviews/digest.log']);
const tracked = parseDigest(staged.status === 0 ? staged.stdout : '').some((l) => l.verdict === 'pass' && l.content === content);
if (local && tracked) {
  console.log(`reviewed: pass verdict for ${local.task} bound to content ${content.slice(0, 12)}`);
  process.exit(0);
}
if (local)
  console.error(`reviewed: pass verdict found for content ${content.slice(0, 12)}, but .harness/reviews/digest.log is not staged with its line.
Stage it (git add .harness/reviews/digest.log): each commit carries its own review evidence (ADR-0195).`);
else
  console.error(`reviewed: no pass verdict for staged content ${content.slice(0, 12)}.
Run the code-review skill: node scripts/harness/review.mjs context --task <ID> …
(Changing reviewed content after review changes the identity — review what you commit.)`);
process.exit(1);
