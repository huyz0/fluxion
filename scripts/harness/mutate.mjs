#!/usr/bin/env node
// Mutation testing with tzap (ADR-0146, NFR-MNT-005).
//   pnpm mutate [--package <dir>]... [--from <ref>] [--out-dir <dir>] [--check]
// Mutates the sources of the chosen packages (default: every pure package) and runs the repo's own
// Vitest through tzap; writes <out-dir>/tzap.json (default reports/tzap) and prints each package's
// score. --from <ref> mutates only lines changed since <ref> (working tree included). --check fails
// when a package's score is below its floor in .harness/baselines/mutation.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, repoPath } from '../gates/lib.mjs';

const TZAP = repoPath('node_modules', '@huyz0', 'tzap', 'dist', 'bin.js');
const FLOORS = '.harness/baselines/mutation.json';
const SOURCES = 'src/**/*.{ts,tsx}';

const argv = process.argv.slice(2);
const values = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const pure = () =>
  JSON.parse(readFileSync(repoPath('tools/gen/workspaces.json'), 'utf8'))
    .workspaces.filter((w) => w.runtime === 'pure')
    .map((w) => w.dir);
const packages = values('--package').length ? values('--package').map((p) => p.replace(/\\/g, '/').replace(/\/$/, '')) : pure();
const outDir = resolve(REPO_ROOT, values('--out-dir')[0] ?? 'reports/tzap');
const from = values('--from')[0];

if (!existsSync(TZAP)) {
  console.error('mutate: @huyz0/tzap is not installed (pnpm install)');
  process.exit(2);
}
for (const p of packages) {
  if (!existsSync(repoPath(p, 'src'))) {
    console.error(`mutate: ${p} has no src/ directory`);
    process.exit(2);
  }
}

// discovery sees one root Vitest package (test.projects); the model narrows its sources to the
// chosen packages, so their mutants are killed by every project's tests
const tzap = (args, opts = {}) => spawnSync(process.execPath, [TZAP, ...args], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const discovered = tzap(['model']);
const model = JSON.parse(discovered.stdout.slice(discovered.stdout.indexOf('{')));
if (model.packages.length !== 1) {
  console.error(`mutate: expected one root package from tzap discovery, got ${model.packages.length}`);
  process.exit(3);
}
model.packages[0].sources = packages.map((p) => `${p}/${SOURCES}`);
// a model's root resolves against the model file's folder: pin it to the repo
model.root = REPO_ROOT;
mkdirSync(outDir, { recursive: true });
const modelFile = join(outDir, 'model.json');
writeFileSync(modelFile, `${JSON.stringify(model, null, 2)}\n`);

// `-Local-` (the working tree) starts with a dash: tzap's parser needs it in the `--to=` form
const scope = from ? ['--from', from, '--to=-Local-'] : [];
// only this run's report counts: a report left by an earlier run is removed first (M4.3 review F2)
const report = join(outDir, 'tzap.json');
rmSync(report, { force: true });
const r = tzap(['run', '-m', modelFile, ...scope, '-r', 'console,json', '-o', outDir, '-q'], { stdio: 'inherit' });
// tzap exits 0 (met its bar) or 1 (below a bar we do not set); 2 is a usage error, 3 a broken
// analysis, null a signal: none of those is a result to score
if ((r.status !== 0 && r.status !== 1) || !existsSync(report)) {
  console.error(`mutate: tzap failed (exit ${r.status ?? r.signal})${existsSync(report) ? '' : ' and wrote no report'}`);
  process.exit(r.status === 2 ? 2 : 3);
}

/** Mutation score of the mutants under `pkg`: detected over valid, as tzap and StrykerJS count it. */
function scoreOf(mutants, pkg) {
  const mine = mutants.filter((m) => m.file.startsWith(`${pkg}/`));
  const count = (...s) => mine.filter((m) => s.includes(m.status)).length;
  const valid = count('Killed', 'Timeout', 'Survived', 'NoCoverage');
  return { valid, score: valid === 0 ? 100 : (100 * count('Killed', 'Timeout')) / valid, noCoverage: count('NoCoverage') };
}

const { mutants } = JSON.parse(readFileSync(report, 'utf8'));
const floors = existsSync(repoPath(FLOORS)) ? (JSON.parse(readFileSync(repoPath(FLOORS), 'utf8')).packages ?? {}) : {};
const below = [];
for (const p of packages) {
  const s = scoreOf(mutants, p);
  const floor = floors[p]?.score;
  console.log(
    `mutate: ${p}: ${s.score.toFixed(1)} % of ${s.valid} valid mutants (${s.noCoverage} uncovered)${floor === undefined ? '' : `, floor ${floor} %`}`,
  );
  // a diff-scoped run scores only the changed lines: floors judge whole-package runs
  if (!from && floor !== undefined && s.score < floor) below.push(`${p} ${s.score.toFixed(1)} % < ${floor} %`);
}
if (argv.includes('--check') && below.length) {
  console.error(`mutate: below the floor: ${below.join('; ')}`);
  process.exit(1);
}

process.exit(0);
