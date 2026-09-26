// Shared helpers for gate and harness scripts. Node >= 22, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? res.error?.message ?? '' };
}

export const node = (script, args = [], opts) => run(process.execPath, [repoPath(script), ...args], opts);

/** `run` without blocking, so independent gate steps can overlap. Same result shape. */
export function runAsync(cmd, args = [], opts = {}) {
  const needsShell = process.platform === 'win32' && !cmd.endsWith('.exe') && cmd !== process.execPath && cmd !== 'git';
  const [file, argv] = needsShell ? [[cmd, ...args].map(quoteWin).join(' '), []] : [cmd, args];
  return new Promise((resolve) => {
    const child = spawn(file, argv, { cwd: REPO_ROOT, shell: needsShell, ...opts });
    const out = { stdout: '', stderr: '' };
    // decode the stream, not each chunk: a multi-byte character may straddle two chunks (M1.28 review F1)
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => {
      out.stdout += d;
    });
    child.stderr?.on('data', (d) => {
      out.stderr += d;
    });
    child.on('error', (e) => resolve({ status: 1, stdout: out.stdout, stderr: `${out.stderr}${e.message}` }));
    child.on('close', (code) => resolve({ status: code ?? 1, ...out }));
  });
}
export const nodeAsync = (script, args = [], opts) => runAsync(process.execPath, [repoPath(script), ...args], opts);
export const git = (args, opts) => run('git', args, opts);

/** Whether Node `version` (x.y.z) is below the floor in an engines range such as ">=22.19". */
export function belowFloor(version, engines) {
  const floor = /(\d+)\.(\d+)(?:\.(\d+))?/
    .exec(engines)
    ?.slice(1, 4)
    .map((n) => Number(n ?? 0)) ?? [22, 0, 0];
  const have = version.split('.').map(Number);
  const first = floor.findIndex((f, i) => have[i] !== f); // the first version part that differs
  return first >= 0 && have[first] < floor[first];
}

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

/** Evaluate one leg: true | string (failure reason) | {ok, detail}; a throw is a failure. */
async function evalLeg(fn) {
  try {
    const r = await fn();
    if (r === true) return { ok: true, detail: '' };
    if (typeof r === 'string') return { ok: false, detail: r };
    if (r && typeof r === 'object') return { ok: Boolean(r.ok), detail: r.detail ?? '' };
    return { ok: false, detail: '' };
  } catch (e) {
    return { ok: false, detail: `threw: ${e?.message ?? e}` };
  }
}

/** Run registered legs, print a summary, exit 0 only if all pass. */
export async function runLegs(title) {
  const summaryOnly = process.argv.includes('--summary');
  let green = 0;
  const lines = [];
  for (const { name, fn } of legs) {
    const { ok, detail } = await evalLeg(fn);
    if (ok) green++;
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  const firstRed = lines.find((l) => l.startsWith('FAIL'));
  if (!summaryOnly) for (const l of lines) console.log(l);
  console.log(`GATE ${title}: ${green}/${legs.length} legs green${firstRed ? ` — next red leg: ${firstRed.slice(5).split(' — ')[0]}` : ''}`);
  process.exit(green === legs.length ? 0 : 1);
}
