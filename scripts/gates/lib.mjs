// Shared helpers for gate and harness scripts. Node >= 22, no dependencies.
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
/**
 * The environment the pre-commit ladder gives its test steps: no GIT_* variable but GIT_EXEC_PATH.
 * A hook exports GIT_DIR, GIT_INDEX_FILE and the like; a test that spawns git with them would
 * reach the repository being committed, whatever directory it runs in (M18.140, cp15 F2).
 * FLUXION_TEST_DURATIONS is dropped too: only the root Vitest run records durations (M18.222), not a
 * harness test or corpus run that starts Vitest in a sandbox or the same checkout.
 */
export const testStepEnv = (env = process.env) =>
  Object.fromEntries(Object.entries(env).filter(([k]) => (!k.startsWith('GIT_') || k === 'GIT_EXEC_PATH') && k !== 'FLUXION_TEST_DURATIONS'));

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

const processOutput = new AsyncLocalStorage();
export const withProcessOutput = (sink, work) => processOutput.run(sink, work);

/**
 * `run` without blocking, so independent gate steps can overlap. Same result shape.
 * `settle` (M18.281) unsticks a command that reported success but does not exit: once `settle.done` matches its output, it
 * gets `settle.ms` to exit, and is then ended with its whole process tree; the process table goes to `settle.reportDir`
 * first, a `::warning::` line is printed, and the result is status 0 with `stuck` set to the report's path. A command that
 * fails, or never prints `done`, keeps its own result.
 */
export function runAsync(cmd, args = [], opts = {}) {
  const { settle, idle, ...spawnOpts } = opts;
  const needsShell = process.platform === 'win32' && !cmd.endsWith('.exe') && cmd !== process.execPath && cmd !== 'git';
  const [file, argv] = needsShell ? [[cmd, ...args].map(quoteWin).join(' '), []] : [cmd, args];
  return new Promise((resolve) => {
    // a settled run stays in the caller's process group, so Ctrl-C still reaches it; endTree walks its descendants instead (M18.281 r1 F1)
    const child = spawn(file, argv, { cwd: REPO_ROOT, shell: needsShell, ...spawnOpts });
    const out = { stdout: '', stderr: '' };
    const watchdog = settle ? settleWatch(child, settle, out, resolve) : undefined;
    const quiet = idle ? idleWatch(child, idle, out, resolve) : undefined;
    // decode the stream, not each chunk: a multi-byte character may straddle two chunks (M1.28 review F1)
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => {
      out.stdout += d;
      processOutput.getStore()?.('stdout', d);
      watchdog?.saw(d);
      quiet?.saw();
    });
    child.stderr?.on('data', (d) => {
      out.stderr += d;
      processOutput.getStore()?.('stderr', d);
      watchdog?.saw(d);
      quiet?.saw();
    });
    child.on('error', (e) => resolve({ status: 1, stdout: out.stdout, stderr: `${out.stderr}${e.message}` }));
    child.on('close', (code) => {
      watchdog?.stop();
      quiet?.stop();
      resolve({ status: code ?? 1, ...out });
    });
  });
}

/** turbo's closing summary when every task succeeded: `Tasks:    37 successful, 37 total` (M18.281). */
export const TURBO_ALL_SUCCESSFUL = /^\s*Tasks:\s+(\d+) successful, \1 total\s*$/m;

/** The table of running processes with their command lines, for a stuck command's report (M18.281). */
export function processTable() {
  const res =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine | Format-List | Out-String -Width 4096',
          ],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        )
      : spawnSync('ps', ['-eo', 'pid,ppid,pgid,etime,args'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res.stdout || res.stderr || String(res.error?.message ?? 'no process table');
}

/** The pids under `root` (itself included) in a `ps -eo pid,ppid` table, parents first. */
export function descendants(table, root) {
  const children = new Map();
  for (const [pid, ppid] of table
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))) {
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const out = [];
  for (let queue = [root]; queue.length > 0; ) {
    const pid = queue.shift();
    out.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return out;
}

/** The process tree under `child` ended at once: taskkill /T on Windows, every descendant ps lists elsewhere. */
function endTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  const table = spawnSync('ps', ['-eo', 'pid,ppid'], { encoding: 'utf8' }).stdout ?? '';
  for (const pid of descendants(table, child.pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/**
 * `idle` (M18.283) fails a command that prints nothing for `idle.ms`: a Windows verify's Vitest run went silent mid-way and held
 * its step to the 25-minute limit (ci 42159843232). The report (`idle.inFlight(output)` names what was running, then the process
 * table) is saved under `idle.reportDir` and printed to the job log, the tree is ended, and the result is status 1.
 */
function idleWatch(child, idle, out, resolve) {
  let timer;
  let fired = false;
  const stalled = () => {
    fired = true;
    const all = `${out.stdout}\n${out.stderr}`;
    const running = idle.inFlight?.(all) ?? [];
    const table = processTable();
    mkdirSync(idle.reportDir, { recursive: true });
    const report = join(idle.reportDir, `${idle.label ?? 'command'}-stalled-${Date.now()}.txt`);
    writeFileSync(report, `in flight:\n${running.join('\n') || '(none named)'}\n\nlast output:\n${all.slice(-4000)}\n\n${table}`);
    // the job log is readable without an artifact download: name the files and the processes there too
    // Windows' Format-List gives one blank-line-separated block per process, ps one line each
    const blocks = table.split(/\r?\n\s*\r?\n/);
    const relevant = (blocks.length > 1 ? blocks : table.split('\n'))
      .filter((b) => /node|chrom|pnpm|vitest/i.test(b))
      .join('\n')
      .slice(0, 20_000);
    const line = `::error::${idle.label ?? 'the command'} printed nothing for ${Math.round(idle.ms / 1000)} s; in flight: ${running.join(', ') || 'none named'}; ended its process tree, report in ${rel(report)} (M18.283)\n`;
    // print: false keeps a harness test's stand-in from annotating the job that runs the test
    if (idle.print !== false) process.stdout.write(`${line}${relevant}\n`);
    endTree(child);
    resolve({ status: 1, stdout: out.stdout, stderr: `${out.stderr}${line}`, stalled: report });
  };
  const arm = () => {
    // once fired, output from a process the tree kill missed must not re-arm a second report (M18.283 r1 F3)
    if (fired) return;
    clearTimeout(timer);
    timer = setTimeout(stalled, idle.ms);
  };
  arm();
  return { saw: arm, stop: () => clearTimeout(timer) };
}

function settleWatch(child, settle, out, resolve) {
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  let tail = '';
  let timer;
  const stuck = () => {
    mkdirSync(settle.reportDir, { recursive: true });
    const report = join(settle.reportDir, `stuck-${Date.now()}.txt`);
    writeFileSync(report, `${settle.label ?? 'command'} printed its done line and had not exited ${settle.ms} ms later\n\n${processTable()}`);
    const line = `::warning::${settle.label ?? 'the command'} reported success but had not exited after ${Math.round(settle.ms / 1000)} s; ended its process tree, process table in ${rel(report)} (M18.281)\n`;
    if (settle.print !== false) process.stdout.write(line);
    endTree(child);
    resolve({ status: 0, stdout: `${out.stdout}${line}`, stderr: out.stderr, stuck: report });
  };
  return {
    saw(d) {
      if (timer) return;
      tail = (tail + d).replace(ANSI, '').slice(-4000);
      if (settle.done.test(tail)) timer = setTimeout(stuck, settle.ms);
    },
    stop: () => clearTimeout(timer),
  };
}
export const nodeAsync = (script, args = [], opts) => runAsync(process.execPath, [repoPath(script), ...args], opts);
export const git = (args, opts) => run('git', args, opts);

/** The reason in a "<tool>: SKIP — <reason>" line of a tool's output, or null (M1.19, M1 cp1 F3). */
export function nestedSkip(stdout) {
  return /^[\w-]+: SKIP — (.+)$/m.exec(stdout ?? '')?.[1]?.trim() ?? null;
}

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

/**
 * The files a Vitest progress log (tools/vitest/progress-reporter.mjs) started and has not ended, oldest first: the test step's
 * idle report (M18.283). It lives here, not beside the reporter, because the harness sandboxes copy scripts/ only.
 */
export function inFlight(log) {
  const open = new Map();
  for (const m of log.matchAll(/^vitest-progress: (queued|start|end) (.+)$/gm)) {
    if (m[1] === 'end') open.delete(m[2]);
    else open.set(m[2], m[1]);
  }
  // a file queued and never started was still loading (imported, transformed, collected): say so (M18.283 r1 F1)
  return [...open].map(([file, event]) => (event === 'queued' ? `${file} (loading)` : file));
}
