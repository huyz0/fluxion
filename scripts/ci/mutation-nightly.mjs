#!/usr/bin/env node
// NFR-MNT-005: one full plan, complete raw partition artifacts, and a derived evidence receipt.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { failureAnnotation } from '../gates/failure-report.mjs';
import { partitionManifest } from '../harness/mutation-partitions.mjs';
import { buildPlan, samePlan } from '../harness/mutation-plan.mjs';
import { MUTATION_EVIDENCE_PREFIX, mutationReceipt } from './mutation-evidence.mjs';

const [command, ...args] = process.argv.slice(2);
const option = (flag) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
const escapeCommandData = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function collect(output) {
  rmSync(output, { force: true });
  const plan = buildPlan(),
    parts = partitionManifest(plan);
  if (parts.length > 256) throw new Error(`mutation matrix exceeds 256 jobs: ${parts.length}; no scope was dropped`);
  write(output, plan);
  const matrix = { include: parts.map((p) => ({ id: p.id })) };
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  console.log(`mutation plan: ${parts.length} complete partitions, ${plan.mutants.length} mutants at ${plan.revision}`);
}

function aggregate(output) {
  rmSync(output, { force: true });
  const manifest = option('--manifest'),
    reports = option('--reports');
  if (!manifest || !reports) throw new Error('--manifest and --reports are required');
  const plan = json(resolve(manifest));
  if (!samePlan(plan, buildPlan())) throw new Error('manifest differs from the current clean checkout');
  const shards = readdirSync(resolve(reports), { withFileTypes: true }).map((entry) => {
    if (!entry.isDirectory()) throw new Error(`unexpected partition artifact: ${entry.name}`);
    return json(join(resolve(reports), entry.name, 'shard.json'));
  });
  const receipt = mutationReceipt(plan, shards);
  write(output, receipt);
  for (const score of receipt.scores)
    console.log(`${score.package}: ${score.score.toFixed(1)} % of ${score.valid} valid / ${score.total} total, floor ${score.floor} %`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice::${escapeCommandData(MUTATION_EVIDENCE_PREFIX + JSON.stringify(receipt))}`);
}

const output = option('--out');
try {
  if (!output) throw new Error('--out is required');
  if (command === 'plan') collect(resolve(output));
  else if (command === 'aggregate') aggregate(resolve(output));
  else throw new Error('expected plan or aggregate');
} catch (error) {
  if (command === 'aggregate' && output) write(resolve(output), { schemaVersion: 1, ok: false, errors: [error.message] });
  console.error(`mutation ${command}: ${error.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(failureAnnotation(`mutation ${command}`, [error.message]));
  process.exitCode = 1;
}
