// Blocking backlog rows (M18.123): while a row whose title carries `blocks-landing` is not done,
// only the blocking row's commits and harness-path commits may land. Shared by check-checkpoint
// (commit-msg hook and exact-commit CI) and land.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { node, repoPath } from './lib.mjs';

const MARK = '`blocks-landing`';
/**
 * Harness code: the one positive list of paths a commit may touch to land while a row blocks
 * landing. Product and contract sources under scripts/ (fonts, format, packs...) and docs/
 * (requirements, architecture...) are not on it (M18.135, cp15 F1).
 */
export const HARNESS_PATHS = [
  'scripts/gates/',
  'scripts/harness/',
  'scripts/ci/',
  'scripts/tooling/',
  'tests/harness/',
  '.harness/',
  '.github/',
  '.githooks/',
  '.agents/',
  '.claude/',
  'docs/backlog/',
  'docs/milestones/',
  'docs/harness/',
  'AGENTS.md',
  'CLAUDE.md',
];
export const harnessPath = (path) => HARNESS_PATHS.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
const taskOf = (subject) => /^(M\d+\.\d+):/.exec(subject)?.[1] ?? null;

/** Backlog rows as { id, title, state }. */
function rows(backlog) {
  return String(backlog ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 9 && /^M\d+\.\d+$/.test(cells[1]))
    .map((cells) => ({ id: cells[1], title: cells[2], state: cells[6] }));
}

/** Open rows marked `blocks-landing`. */
export function blockingRows(backlog) {
  return rows(backlog).filter((row) => row.title.includes(MARK) && !/^done\b/.test(row.state));
}

/**
 * Why a commit that stops rows blocking, from its own parent's `before` backlog to its `proposed` one, may not land on `backlog`, or
 * null: closing one needs a green three-OS record (`evidence`, the ci-evidence.json of the commit's
 * tree, written by check-ci-evidence --record after reading the runs live) for the parent or later;
 * `evidenceOk(record)` answers it, normally by `ciEvidenceHolds` (M18.135).
 */
function closeBlock({ backlog, before, proposed, evidence, evidenceOk }) {
  // done, removed or unmarked: any way the commit itself stops a blocking row blocking needs the evidence
  const was = new Set(blockingRows(before).map((r) => r.id));
  const still = new Set(blockingRows(proposed).map((r) => r.id));
  const closed = blockingRows(backlog).filter((r) => was.has(r.id) && !still.has(r.id));
  if (!closed.length) return null;
  let record;
  try {
    record = JSON.parse(evidence || 'null');
  } catch {
    record = null;
  }
  const green = record?.runs?.ci && record.runs.gates && typeof record.sha === 'string' && evidenceOk(record);
  if (green) return null;
  const names = closed.map((r) => r.id).join(', ');
  return `it closes ${names} (done, removed or unmarked) without a green three-OS CI record for its parent or later (check-ci-evidence.mjs --record <sha>)`;
}

/**
 * Why a commit with `subject` may not land on a tree with this `backlog`, or null. While a row
 * blocks landing, only that row's task commits and commits whose every changed path is a harness path
 * land, whatever the row's Req cell says (M18.135): neither a label nor a row the commit brings
 * itself exempts product code. No commit closes a blocking row without CI evidence.
 */
export function landingBlock({ backlog, subject, before = backlog, proposed = '', paths = [], evidence = '', evidenceOk = () => false }) {
  const blocking = blockingRows(backlog);
  if (!blocking.length) return null;
  // every commit, task or not (a Revert, a fixup), is judged: only the row's own task commits are exempt from the paths (r1 F1)
  const task = taskOf(subject);
  const who = task ?? `"${subject}"`;
  const closing = closeBlock({ backlog, before, proposed, evidence, evidenceOk });
  if (closing) return `${who}: ${closing}`;
  if (blocking.some((row) => row.id === task)) return null;
  const outside = paths.find((path) => !harnessPath(path));
  if (!outside) return null;
  const names = blocking.map((r) => r.id).join(', ');
  return `${who} changes ${outside}, which is not a harness path, and ${names} blocks landing until done (\`blocks-landing\`); land the blocking row first`;
}

/**
 * Whether check-ci-evidence holds `record` live: its gates and ci runs succeeded on `record.sha`, on
 * every OS, and that sha is at or after `parent` (M18.135 r1 F2: a hand-written record is not
 * evidence). `runsFile` stands in for GitHub in tests.
 */
export function ciEvidenceHolds(record, parent, { runsFile } = {}) {
  const file = repoPath('.harness', 'tmp', 'landing-ci-evidence.json');
  mkdirSync(repoPath('.harness', 'tmp'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  const r = node('scripts/gates/check-ci-evidence.mjs', ['--file', file, '--since', parent, ...(runsFile ? ['--runs-file', runsFile] : [])]);
  if (r.status !== 0) console.error(r.stderr.trim());
  return r.status === 0;
}
