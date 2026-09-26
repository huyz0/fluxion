// Test helpers for the harness gates. Each gate derives REPO_ROOT from its own location, so we
// copy the harness into a temp directory and run the copy against a deliberately broken tree.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Environment without git's hook variables. Tests also run inside the pre-commit hook, where git
 * exports GIT_INDEX_FILE (relative), GIT_AUTHOR_* etc.; sandbox repos and worktrees must not
 * inherit them (a linked worktree's `.git` is a file, so `.git/index` breaks it).
 */
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_EXEC_PATH'));

/**
 * Build state that other ladder steps rewrite while the harness tests run concurrently (M1.28):
 * `tsc -b` replaces .tsbuild files, attw packs tarballs. Copying it races those writers (ENOENT on a
 * file that vanished mid-copy) and no sandbox needs it (M1.33).
 */
export const TRANSIENT = /[\\/](\.tsbuild|node_modules|coverage|\.turbo)([\\/]|$)|\.tgz$/;

const DEFAULT_PATHS = ['scripts', '.agents', '.claude/skills', 'AGENTS.md', 'CLAUDE.md', 'docs/backlog', 'docs/milestones/roadmap.md', '.harness/state.json'];

/**
 * Link the repo's installs into a sandbox that copied workspaces: the root node_modules and each
 * workspace's own (apps/studio keeps react there). Junctions, so nothing is copied or reinstalled.
 */
export function linkInstalls(sb) {
  symlinkSync(join(REPO, 'node_modules'), sb.path('node_modules'), 'junction');
  const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
  for (const { dir } of workspaces) {
    if (existsSync(join(REPO, dir, 'node_modules')) && existsSync(sb.path(dir)))
      symlinkSync(join(REPO, dir, 'node_modules'), sb.path(`${dir}/node_modules`), 'junction');
  }
}

/** Copy harness files into a fresh temp dir. Returns helpers bound to it. */
export function sandbox(paths = DEFAULT_PATHS, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-harness-'));
  for (const p of paths) cpSync(join(REPO, p), join(dir, p), { recursive: true, filter: (src) => !TRANSIENT.test(src) });
  const sb = {
    dir,
    path: (p) => join(dir, p),
    read: (p) => readFileSync(join(dir, p), 'utf8'),
    readRepo: (p) => readFileSync(join(REPO, p), 'utf8'),
    write: (p, text) => {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    },
    edit: (p, fn) => sb.write(p, fn(sb.read(p))),
    node: (script, args = [], opts = {}) =>
      spawnSync(process.execPath, [join(dir, script), ...args], { cwd: dir, encoding: 'utf8', ...opts, env: cleanEnv(opts.env) }),
    git: (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  if (git) {
    sb.git('init', '-q', '-b', 'main');
    sb.git('config', 'user.email', 'test@example.invalid');
    sb.git('config', 'user.name', 'harness-test');
    sb.git('config', 'core.autocrlf', 'false');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'fixture baseline', '--no-verify');
  }
  return sb;
}

/** Assert helper: returns combined output for failure messages. */
export const out = (r) => `status=${r.status}\n${r.stdout}\n${r.stderr}`;
