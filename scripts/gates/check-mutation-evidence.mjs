#!/usr/bin/env node
// NFR-MNT-005: always re-read hosted execution; a local receipt alone is never qualification.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateMutationEvidence } from '../ci/mutation-evidence.mjs';
import { readMutationEvidence } from '../ci/mutation-evidence-source.mjs';
import { inspectPlan } from '../harness/mutation-plan.mjs';
import { repoPath } from './lib.mjs';
import { mutationProvenance } from './mutation-evidence-provenance.mjs';

export async function checkMutationRecord(record, milestone, { read = readMutationEvidence, inspect = inspectPlan, provenance = mutationProvenance } = {}) {
  if (record?.schemaVersion !== 1 || !Number.isSafeInteger(record.run) || record.run < 1) throw new Error('invalid mutation evidence record');
  const head = provenance(record.sha, milestone);
  const plan = inspect();
  const evidence = await read(record.run);
  if (evidence?.run?.id !== record.run) throw new Error('mutation run ID differs from record');
  const result = validateMutationEvidence(evidence, plan, record.sha);
  if (!result.ok) throw new Error(result.errors.join('; '));
  if (provenance(record.sha, milestone) !== head) throw new Error('revision changed while reading mutation evidence');
  return result;
}

async function main(argv) {
  const opt = (key) => argv[argv.indexOf(key) + 1];
  const milestone = argv.includes('--milestone') ? opt('--milestone') : 'M18';
  const file = repoPath('.harness', 'reviews', 'mutation-evidence.json');
  let record;
  if (argv.includes('--record')) {
    const id = Number(opt('--record'));
    const evidence = await readMutationEvidence(id);
    record = { schemaVersion: 1, run: id, sha: evidence.run.head_sha };
  } else {
    if (!existsSync(file)) throw new Error('no mutation evidence: record a completed qualifying nightly with --record <run-id>');
    record = JSON.parse(readFileSync(file, 'utf8'));
  }
  const result = await checkMutationRecord(record, milestone);
  if (argv.includes('--record')) writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`mutation-evidence: ${record.sha} run ${record.run}; ${result.receipt.partitions.length} complete partitions, all package floors passed`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`mutation-evidence: ${error.message}`);
    process.exitCode = 1;
  });
}
