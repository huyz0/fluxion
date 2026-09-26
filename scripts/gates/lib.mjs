// Shared helpers for gate and harness scripts. Node >= 22, no dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const repoPath = (...parts) => join(REPO_ROOT, ...parts);
export const rel = (abs) => relative(REPO_ROOT, abs).split(sep).join('/');
export const exists = (p) => existsSync(repoPath(p));
export const readText = (p) => readFileSync(repoPath(p), 'utf8');

/** Quote one argument for cmd.exe (Windows shell used to resolve .cmd shims like pnpm/codex). */
export const quoteWin = (a) => (/^[\w.,:/\\=@+-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** Run a command in the repo root. Returns { status, stdout, stderr }. Never throws. */
export function run(cmd, args = [], opts = {}) {
  // Windows needs a shell to run .cmd shims (pnpm, npx, codex). Passing an args array together
  // with shell:true concatenates unescaped (DEP0190), so build one quoted command line instead.
  const needsShell = process.platform === 'win32' && !cmd.endsWith('.exe') && cmd !== process.execPath && cmd !== 'git';
  const [file, argv] = needsShell ? [[cmd, ...args].map(quoteWin).join(' '), []] : [cmd, args];
  const res = spawnSync(file, argv, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: needsShell,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? (res.error?.message ?? '') };
}

export const node = (script, args = [], opts) => run(process.execPath, [repoPath(script), ...args], opts);
export const git = (args, opts) => run('git', args, opts);

/** The exact staged bytes a review verdict is bound to. */
export const stagedDiff = () => git(['diff', '--cached', '--binary', '--no-color', '--no-ext-diff']).stdout;
export const stagedHash = () => createHash('sha256').update(stagedDiff()).digest('hex');

/** Recursively list files under a repo-relative dir (skips node_modules/.git/dist). */
export function listFiles(dir, filter = () => true) {
  const out = [];
  const root = repoPath(dir);
  if (!existsSync(root)) return out;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (['node_modules', '.git', 'dist', 'coverage', '.turbo'].includes(name)) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (filter(rel(full))) out.push(rel(full));
    }
  };
  walk(root);
  return out.sort();
}

/** Parse simple YAML front matter (key: value, single-line values only). */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { data, body: m[2] };
}

/** Current milestone from the roadmap line "**Current milestone: `M<n>`**". */
export function currentMilestone() {
  const m = /\*\*Current milestone: `(M\d+)`\*\*/.exec(readText('docs/milestones/roadmap.md'));
  return m ? m[1] : null;
}

// ---------- completion-gate legs ----------
const legs = [];

/** Register a leg. fn returns true | string (failure reason) | {ok, detail}. */
export function leg(name, fn) {
  legs.push({ name, fn });
}

/** Run registered legs, print a summary, exit 0 only if all pass. */
export async function runLegs(title) {
  const summaryOnly = process.argv.includes('--summary');
  let green = 0;
  const lines = [];
  for (const { name, fn } of legs) {
    let ok = false;
    let detail = '';
    try {
      const r = await fn();
      if (r === true) ok = true;
      else if (typeof r === 'string') detail = r;
      else if (r && typeof r === 'object') ({ ok, detail = '' } = r);
    } catch (e) {
      detail = `threw: ${e?.message ?? e}`;
    }
    if (ok) green++;
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  const firstRed = lines.find((l) => l.startsWith('FAIL'));
  if (!summaryOnly) for (const l of lines) console.log(l);
  console.log(`GATE ${title}: ${green}/${legs.length} legs green${firstRed ? ` — next red leg: ${firstRed.slice(5).split(' — ')[0]}` : ''}`);
  process.exit(green === legs.length ? 0 : 1);
}
