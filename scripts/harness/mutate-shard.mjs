// NFR-MNT-005: wrap the existing full-package runner; do not change its test projects or mutators.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { failureLines } from '../gates/failure-report.mjs';
import { REPO_ROOT, run } from '../gates/lib.mjs';
import { emitMutationDiagnostic } from './mutation-diagnostics.mjs';
import { DEFAULT_PARTITION_TARGET, partitionManifest, validatePartition } from './mutation-partitions.mjs';
import { buildPlan, samePlan } from './mutation-plan.mjs';
import { aggregateShards } from './mutation-shards.mjs';

/** Lines of a red baseline test's failure output the job log keeps: its last ones, where TAP puts the assertion and stack (M18.286). */
export const RED_TEST_LINES = 200;

/** A red test's heading: its id, then its name and file when the report has them. */
function redTestHeading(test) {
  const where = test?.name ? ` (${[test.name, test.file].filter(Boolean).join(', ')})` : '';
  return `mutation shard: baseline test failed with no mutant applied: ${test?.id ?? '(no id)'}${where}`;
}

/** A red test's failure output without trailing blank lines, or [] when the report holds none. */
function redTestOutput(test) {
  const output = typeof test?.message === 'string' ? test.message.split(/\r?\n/) : [];
  while (output.length > 0 && output.at(-1) === '') output.pop();
  return output;
}

/**
 * Each baseline test the report names red (it failed with no mutant applied), with its id and the end of its failure output.
 * tzap's own summary prints only the first line of that output, which for a node:test file is "TAP version 13" (M18.286).
 */
export function redTestLines(report) {
  const red = Array.isArray(report?.redTests) ? report.redTests : [];
  return red.flatMap((test) => {
    const output = redTestOutput(test);
    const kept = output.slice(-RED_TEST_LINES);
    return [
      redTestHeading(test),
      ...(output.length > kept.length ? [`  [${output.length - kept.length} earlier lines; last ${RED_TEST_LINES} follow]`] : []),
      ...(kept.length > 0 ? kept.map((line) => `  ${line}`) : ['  (the report holds no failure output for it)']),
    ];
  });
}

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

function executionScope(plan, { packageName, partitionId, target, outDir }) {
  const partition = partitionId ? partitionManifest(plan, target).find((p) => p.id === partitionId) : undefined;
  if (partitionId && !partition) throw new Error(`unexpected partition ${partitionId}`);
  if (partition && packageName && packageName !== partition.package) throw new Error('partition/package mismatch');
  packageName = partition?.package ?? packageName;
  const expected = forPackage(plan, packageName);
  const scope = partition ? ['--sources-file', join(outDir, 'sources.json')] : ['--check'];
  if (partition) writeFileSync(scope[1], JSON.stringify(partition.files.filter((f) => /\.tsx?$/.test(f))));
  return { partition, packageName, expected, scope };
}

function validateExecution(plan, execution, shard) {
  if (execution.partition) return validatePartition(plan, execution.partition, shard);
  const verdict = aggregateShards(execution.expected, [shard]);
  if (!verdict.ok) throw new Error(verdict.errors.join('; '));
}

/** Preserve raw engine evidence and emit a failing envelope whenever execution or validation fails. */
export function runPackage({ manifestPath, packageName, partitionId, target = DEFAULT_PARTITION_TARGET, outDir, root = REPO_ROOT }) {
  const started = performance.now();
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, 'shard.json');
  rmSync(output, { force: true });
  const shard = { schemaVersion: 1, package: packageName, partition: partitionId, exitCode: 1 };
  let details = [],
    mutants;
  try {
    const plan = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!samePlan(plan, buildPlan(root))) throw new Error('manifest does not match the current checkout inventory');
    const execution = executionScope(plan, { packageName, partitionId, target, outDir });
    packageName = execution.packageName;
    shard.package = packageName;
    const { expected, scope } = execution;
    Object.assign(shard, { revision: plan.revision, runner: plan.runner, files: expected.files });
    console.log(`mutation shard: start ${packageName}, ${execution.partition?.mutants ?? expected.mutants.length} mutants at ${plan.revision}`);
    const result = run(process.execPath, [join(root, 'scripts/harness/mutate.mjs'), '--package', packageName, '--out-dir', outDir, ...scope], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    details = failureLines(result.stdout, result.stderr);
    shard.exitCode = result.status;
    const report = join(outDir, 'tzap.json');
    if (existsSync(report)) shard.report = JSON.parse(readFileSync(report, 'utf8'));
    // a red baseline fails the shard below (failed baseline tests); its output goes to the log first, in full up to RED_TEST_LINES
    const red = redTestLines(shard.report);
    if (red.length > 0) {
      console.error(red.join('\n'));
      details.push(...red);
    }
    if (result.status !== 0) throw new Error(`package execution exited ${result.status}`);
    if (!samePlan(plan, buildPlan(root))) throw new Error('checkout changed during mutation execution');
    validateExecution(plan, execution, shard);
    mutants = shard.report.mutants;
  } catch (error) {
    shard.exitCode ||= 1;
    shard.error = error.message;
    console.error(`mutation shard: ${packageName}: ${error.message}`);
  }
  shard.elapsedMs = performance.now() - started;
  writeFileSync(output, `${JSON.stringify(shard, null, 2)}\n`);
  console.log(`mutation shard: ${packageName}, exit ${shard.exitCode}, ${shard.elapsedMs.toFixed(0)} ms`);
  emitMutationDiagnostic({ label: partitionId ?? packageName, mutants, error: shard.error, details });
  return shard.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (flag) => {
    const index = process.argv.indexOf(flag);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const manifestPath = value('--manifest'),
    packageName = value('--package'),
    partitionId = value('--partition'),
    target = value('--target-mutants') === undefined ? DEFAULT_PARTITION_TARGET : Number(value('--target-mutants')),
    outDir = value('--out-dir');
  if (!manifestPath || (!packageName && !partitionId) || !outDir) {
    const usage = 'usage: mutate-shard.mjs --manifest FILE (--package DIR | --partition ID) --out-dir DIR';
    console.error(usage);
    emitMutationDiagnostic({ label: 'CLI', error: usage });
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = runPackage({ manifestPath: resolve(manifestPath), packageName, partitionId, target, outDir: resolve(outDir) });
    } catch (error) {
      console.error(error);
      emitMutationDiagnostic({ label: partitionId ?? packageName, error: error.message });
      process.exitCode = 1;
    }
  }
}
