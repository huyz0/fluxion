// NFR-MNT-005: collect expected mutation scope independently of completed reports.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, run } from '../gates/lib.mjs';
import { createManifest } from './mutation-shards.mjs';

function command(root, executable, args) {
  const result = run(executable, args, { cwd: root });
  if (result.status !== 0) throw new Error(`${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function trackedInputs(root) {
  const git = (args) => command(root, 'git', args).split('\0').filter(Boolean);
  const changed = git(['diff', 'HEAD', '--name-only', '-z']).filter((p) => p !== '.harness/reviews/digest.log');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  if (changed.length || untracked.length) throw new Error(`mutation evidence requires clean inputs: ${[...changed, ...untracked].join(', ')}`);
  return git(['ls-files', '-z']).filter((p) => p !== '.harness/reviews/digest.log');
}

function discover(root, packages) {
  const tzap = join(root, 'node_modules/@huyz0/tzap/dist/bin.js');
  const call = (args) => command(root, process.execPath, [tzap, ...args]);
  const output = call(['model']);
  const model = JSON.parse(output.slice(output.indexOf('{')));
  if (!Array.isArray(model.packages) || model.packages.length !== 1) throw new Error('expected one root mutation test project');
  model.root = root;
  model.packages[0].sources = packages.map((pkg) => `${pkg}/src/**/*.{ts,tsx}`);
  const dir = mkdtempSync(join(tmpdir(), 'mutation-plan-'));
  try {
    const file = join(dir, 'model.json');
    writeFileSync(file, JSON.stringify(model));
    return JSON.parse(call(['list-mutants', '-m', file, '--format', 'json']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Inventory all pure packages at a clean revision, retaining the discovered test configuration. */
export function buildPlan(root = REPO_ROOT) {
  const inputs = trackedInputs(root);
  const revision = command(root, 'git', ['rev-parse', 'HEAD']).trim();
  const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const packages = json('tools/gen/workspaces.json')
    .workspaces.filter((p) => p.runtime === 'pure')
    .map((p) => p.dir)
    .sort();
  const version = json('node_modules/@huyz0/tzap/package.json').version;
  const hashes = inputs.map((file) => [
    file,
    createHash('sha256')
      .update(readFileSync(join(root, file)))
      .digest('hex'),
  ]);
  const environment = Object.fromEntries(['CI', 'FC_RUNS', 'FC_SEED', 'NODE_OPTIONS', 'TZAP_NODE_TEST_TIMEOUT'].map((key) => [key, process.env[key] ?? null]));
  const runner = createHash('sha256')
    .update(JSON.stringify({ version, node: process.version, environment, hashes }))
    .digest('hex');
  const files = Object.fromEntries(hashes.filter(([file]) => packages.some((pkg) => file.startsWith(`${pkg}/src/`))));
  const mutants = discover(root, packages);
  trackedInputs(root);
  if (command(root, 'git', ['rev-parse', 'HEAD']).trim() !== revision) throw new Error('revision changed during inventory collection');
  return createManifest({
    revision,
    runner,
    version,
    packages,
    files,
    mutants,
    floors: json('.harness/baselines/mutation.json').packages,
  });
}

/** Compare complete plans without relying on engine enumeration order. */
export function samePlan(a, b) {
  const ordered = (plan) => ({ ...plan, mutants: [...plan.mutants].sort((x, y) => x.id.localeCompare(y.id)) });
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const index = process.argv.indexOf('--out');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--out is required');
    const output = resolve(process.argv[index + 1]);
    rmSync(output, { force: true });
    const plan = buildPlan();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`mutation plan: ${plan.packages.length} packages, ${plan.mutants.length} mutants at ${plan.revision}`);
  } catch (error) {
    console.error(`mutation plan: ${error.message}`);
    process.exitCode = 1;
  }
}
