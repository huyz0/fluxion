// A fast-check counterexample that refused a staged run is replayed until it is fixed, never
// re-rolled (M18.275, cp45 F2). Local runs leave FC_SEED unpinned (vitest.config.ts), so a seed
// that failed once is gone on the next run; the staged test step records each failure's seed,
// path and test file in an untracked file under the git common directory (every worktree of the
// clone sees it), and the staged ladder's fc-replay step replays each record with FC_SEED on its
// file, refuses while one still fails, and drops a record once it passes. CI (--all) keeps CI_SEED.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { git, REPO_ROOT, repoPath, runAsync, testStepEnv } from './lib.mjs';

const STORE = 'fluxion-fc-failures.json';
// Vitest colours its FAIL headers under FORCE_COLOR (and on win32), even when piped (r1 F3)
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
const ANSI = /\u001b\[[0-9;]*m/g;
const FAIL_LINE = /^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S+\.test\.[cm]?[jt]sx?)\b/;
const SEED_LINE = /\{\s*seed:\s*(-?\d+),\s*path:\s*"([^"]*)"/;
const TAIL = 40;

/** The fast-check failures in a Vitest run's output: the file of the nearest FAIL header above each seed line. */
export function parseFastCheckFailures(output) {
  const found = [];
  let file = null;
  for (const line of String(output).replace(ANSI, '').split(/\r?\n/)) {
    const fail = FAIL_LINE.exec(line);
    if (fail) file = fail[1].replaceAll('\\', '/');
    const seed = SEED_LINE.exec(line);
    if (seed && file && !found.some((f) => f.file === file && f.seed === Number(seed[1]))) found.push({ file, seed: Number(seed[1]), path: seed[2] });
  }
  return found;
}

/** The store file: under the git common directory, so all worktrees of one clone share it. */
export function storePath(cwd = REPO_ROOT) {
  const dir = git(['rev-parse', '--git-common-dir'], { cwd }).stdout.trim();
  return join(isAbsolute(dir) ? dir : join(cwd, dir), STORE);
}

const valid = (r) =>
  r !== null &&
  typeof r === 'object' &&
  typeof r.file === 'string' &&
  r.file !== '' &&
  Number.isInteger(r.seed) &&
  typeof r.path === 'string' &&
  (r.worktree === undefined || typeof r.worktree === 'string');

/**
 * The records, or `{ error }` when the file is not a JSON array of records: an unreadable store is
 * refused, never read as empty, so a recorded seed is not lost to a truncated write (r1 F2).
 */
export function readRecords(path) {
  if (!existsSync(path)) return [];
  let records;
  try {
    records = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: `${path} is not JSON (${e.message})` };
  }
  if (!Array.isArray(records) || !records.every(valid)) return { error: `${path} is not an array of { file, seed, path } records` };
  return records;
}

// write a sibling file and rename it over the store: a reader never sees half a file. A failed
// write (EPERM, a full disk) leaves the store as it was, removes its temporary file and throws a
// message naming the store, which callers report (r2 F2)
const writeRecords = (path, records) => {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`fc-replay: could not write ${path} (${e.message})`);
  }
};
const same = (a, b) => a.file === b.file && a.seed === b.seed;

/**
 * Adds the run's fast-check failures to the store, each with the worktree that recorded it (r2 F1);
 * returns what it added (nothing when the store is unreadable: the replay step refuses it). Throws
 * when the store cannot be written.
 */
export function recordFailures(output, path = storePath(), worktree = REPO_ROOT) {
  const records = readRecords(path);
  if (!Array.isArray(records)) return [];
  const added = parseFastCheckFailures(output).filter((f) => !records.some((r) => same(r, f)));
  if (added.length > 0) writeRecords(path, [...records, ...added.map((f) => ({ ...f, worktree, recorded: new Date().toISOString() }))]);
  return added;
}

/** The command that replays one record: its test file with its seed pinned (r1 F4). */
export const replayCommand = ({ file, seed }, env = process.env) => ({
  cmd: 'pnpm',
  args: ['exec', 'vitest', 'run', file],
  // its own Vite cache: the step runs beside the ladder's test step (M1.36, M5.29)
  env: { ...testStepEnv(env), FC_SEED: String(seed), FLUXION_VITEST_CACHE: repoPath('.vitest-cache/fc-replay') },
});
const vitestReplay = (record) => {
  const { cmd, args, env } = replayCommand(record);
  return runAsync(cmd, args, { env });
};

/** Whether the staged ladder has anything to replay: a store file exists (an unreadable one is refused by the replay). */
export const hasRecords = (path = storePath()) => {
  const records = readRecords(path);
  return !Array.isArray(records) || records.length > 0;
};

/** One record's replay in this tree: `pass` (dropped when `mine`), `fail` with its output, and the line to print. */
async function replayOne(record, { run, present, mine }) {
  const verdict = mine ? 'record dropped' : `record kept for ${record.worktree}`;
  if (!present(record.file)) return { pass: true, line: `fc-replay: ${record.file} is not in this tree; seed ${record.seed} ${verdict}` };
  const r = await run(record);
  if (r.status === 0) return { pass: true, line: `fc-replay: seed ${record.seed} passes ${record.file} here; ${verdict}` };
  return { pass: false, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** Removes the dropped records from the store as it is now, so a record added meanwhile is kept (r1 F2); an error message, or null. */
function dropRecords(path, dropped) {
  if (dropped.length === 0) return null;
  const now = readRecords(path);
  if (!Array.isArray(now)) return null;
  try {
    writeRecords(
      path,
      now.filter((r) => !dropped.some((d) => same(d, r))),
    );
    return null;
  } catch (e) {
    return e.message;
  }
}

const tail = (output) =>
  output
    .replace(ANSI, '')
    .trimEnd()
    .split(/\r?\n/)
    .slice(-TAIL)
    .map((l) => `  ${l}`);

/**
 * Replays each recorded failure with its seed, in this worktree. A record is dropped only by the
 * worktree that recorded it, or by any once that worktree is gone (r2 F1): another stream's tree may
 * lack the file or already hold the fix. Returns a failing result naming each seed that still fails
 * here, with the tail of its replay's output (r1 F5), else `{ status: 0 }`.
 */
export async function replayRecorded({
  path = storePath(),
  run = vitestReplay,
  present = (f) => existsSync(repoPath(f)),
  worktree = REPO_ROOT,
  worktreeExists = existsSync,
} = {}) {
  const records = readRecords(path);
  if (!Array.isArray(records)) return { status: 1, stdout: `fc-replay: ${records.error}; fix or delete it (M18.275)`, stderr: '' };
  const owns = (r) => r.worktree === undefined || r.worktree === worktree || !worktreeExists(r.worktree);
  const dropped = [];
  const lines = [];
  for (const record of records) {
    const mine = owns(record);
    const one = await replayOne(record, { run, present, mine });
    if (one.pass) {
      if (mine) dropped.push(record);
      lines.push(one.line);
    } else
      lines.push(
        `fast-check seed ${record.seed} (path "${record.path}") still fails ${record.file}: FC_SEED=${record.seed} pnpm exec vitest run ${record.file}`,
        ...tail(one.output),
      );
  }
  const failed = lines.some((l) => l.startsWith('fast-check seed '));
  const writeError = dropRecords(path, dropped);
  if (writeError) return { status: 1, stdout: [...lines, writeError].join('\n'), stderr: '' };
  if (!failed) return { status: 0, stdout: lines.join('\n'), stderr: '' };
  return {
    status: 1,
    stdout: [...lines, 'fc-replay: a seed that refused a staged run is replayed until fixed, not re-rolled (M18.275)'].join('\n'),
    stderr: '',
  };
}
