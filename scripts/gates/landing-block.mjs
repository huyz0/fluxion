// Blocking backlog rows (M18.123): while a row whose title carries `blocks-landing` is not done,
// only harness rows and the blocking row itself may land task commits. Shared by check-checkpoint
// (commit-msg hook and exact-commit CI) and land.mjs.
const MARK = '`blocks-landing`';
const HARNESS_PATHS = /^(scripts\/|tests\/harness\/|\.harness\/|\.github\/|\.githooks\/|\.agents\/|\.claude\/|docs\/|AGENTS\.md$|CLAUDE\.md$)/;
const harnessPath = (path) => HARNESS_PATHS.test(path);
const taskOf = (subject) => /^(M\d+\.\d+):/.exec(subject)?.[1] ?? null;

/** Backlog rows as { id, title, req, state }. */
function rows(backlog) {
  return String(backlog ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 9 && /^M\d+\.\d+$/.test(cells[1]))
    .map((cells) => ({ id: cells[1], title: cells[2], req: cells[3], state: cells[6] }));
}

/** Open rows marked `blocks-landing`. */
export function blockingRows(backlog) {
  return rows(backlog).filter((row) => row.title.includes(MARK) && !/^done\b/.test(row.state));
}

/**
 * Why a task commit with `subject` may not land on a tree with this `backlog`, or null. A row is a
 * harness row when its Req cell names HARNESS. A row the commit adds itself is read from its own
 * `proposed` backlog when every changed path is a harness path, so a harness fix can bring its row
 * (M18.139); a row already on the parent keeps
 * the parent's Req cell, so a commit cannot relabel itself. A task in neither is not a harness row.
 */
export function landingBlock(backlog, subject, proposed = '', paths = []) {
  const task = taskOf(subject);
  if (!task) return null;
  const blocking = blockingRows(backlog);
  if (!blocking.length || blocking.some((row) => row.id === task)) return null;
  // a row the commit brings itself counts only for a commit confined to harness paths (M18.139 r1 F1)
  const row = rows(backlog).find((r) => r.id === task) ?? (paths.every(harnessPath) ? rows(proposed).find((r) => r.id === task) : undefined);
  if (row && /\bHARNESS\b/.test(row.req)) return null;
  const names = blocking.map((r) => r.id).join(', ');
  return `${task} is not a harness row and ${names} blocks landing until done (\`blocks-landing\`); land the blocking row first`;
}
