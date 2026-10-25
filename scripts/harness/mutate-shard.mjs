// NFR-MNT-005: wrap the existing full-package runner; do not change its test projects or mutators.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, run } from '../gates/lib.mjs';
import { buildPlan, samePlan } from './mutation-plan.mjs';
import { aggregateShards } from './mutation-shards.mjs';

function forPackage(plan, name) {
  if (!plan.packages.includes(name)) throw new Error(`unexpected package ${name}`);
  return {
    ...plan,
    packages: [name],
    floors: { [name]: plan.floors[name] },
    files: Object.fromEntries(Object.entries(plan.files).filter(([file]) => file.startsWith(`${name}/src/`))),
    mutants: plan.mutants.filter((mutant) => mutant.file.startsWith(`${name}/src/`)),
  };
}

/** Preserve raw engine evidence and emit a failing envelope whenever execution or validation fails. */
export function runPackage({ manifestPath, packageName, outDir, root = REPO_ROOT }) {
  const started = performance.now();
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, 'shard.json');
  rmSync(output, { force: true });
  const shard = { schemaVersion: 1, package: packageName, exitCode: 1 };
  try {
    const plan = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!samePlan(plan, buildPlan(root))) throw new Error('manifest does not match the current checkout inventory');
    const expected = forPackage(plan, packageName);
    Object.assign(shard, { revision: plan.revision, runner: plan.runner, files: expected.files });
    console.log(`mutation shard: start ${packageName}, ${expected.mutants.length} mutants at ${plan.revision}`);
    const result = run(process.execPath, [join(root, 'scripts/harness/mutate.mjs'), '--package', packageName, '--out-dir', outDir, '--check'], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    shard.exitCode = result.status;
    const report = join(outDir, 'tzap.json');
    if (existsSync(report)) shard.report = JSON.parse(readFileSync(report, 'utf8'));
    if (result.status !== 0) throw new Error(`package execution exited ${result.status}`);
    if (!samePlan(plan, buildPlan(root))) throw new Error('checkout changed during mutation execution');
    const verdict = aggregateShards(expected, [shard]);
    if (!verdict.ok) throw new Error(verdict.errors.join('; '));
  } catch (error) {
    shard.exitCode ||= 1;
    shard.error = error.message;
    console.error(`mutation shard: ${packageName}: ${error.message}`);
  }
  shard.elapsedMs = performance.now() - started;
  writeFileSync(output, `${JSON.stringify(shard, null, 2)}\n`);
  console.log(`mutation shard: ${packageName}, exit ${shard.exitCode}, ${shard.elapsedMs.toFixed(0)} ms`);
  return shard.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (flag) => {
    const index = process.argv.indexOf(flag);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const manifestPath = value('--manifest'),
    packageName = value('--package'),
    outDir = value('--out-dir');
  if (!manifestPath || !packageName || !outDir) {
    console.error('usage: mutate-shard.mjs --manifest FILE --package DIR --out-dir DIR');
    process.exitCode = 2;
  } else {
    process.exitCode = runPackage({ manifestPath: resolve(manifestPath), packageName, outDir: resolve(outDir) });
  }
}
