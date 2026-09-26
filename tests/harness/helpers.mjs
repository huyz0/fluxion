// Test helpers for the harness gates. Each gate derives REPO_ROOT from its own location, so we
// copy the harness into a temp directory and run the copy against a deliberately broken tree.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULT_PATHS = ['scripts', '.agents', '.claude/skills', 'AGENTS.md', 'CLAUDE.md', 'docs/backlog', 'docs/milestones/roadmap.md', '.harness/state.json'];

/** Copy harness files into a fresh temp dir. Returns helpers bound to it. */
export function sandbox(paths = DEFAULT_PATHS, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-harness-'));
  for (const p of paths) cpSync(join(REPO, p), join(dir, p), { recursive: true });
  const sb = {
    dir,
    path: (p) => join(dir, p),
    read: (p) => readFileSync(join(dir, p), 'utf8'),
    write: (p, text) => {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    },
    edit: (p, fn) => sb.write(p, fn(sb.read(p))),
    node: (script, args = [], opts = {}) => spawnSync(process.execPath, [join(dir, script), ...args], { cwd: dir, encoding: 'utf8', ...opts }),
    git: (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }),
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
