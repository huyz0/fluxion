// NFR-MNT-005: derive evidence from complete raw partitions, then validate live job provenance.
import { createHash } from 'node:crypto';
import { aggregatePartitions, partitionManifest } from '../harness/mutation-partitions.mjs';
import { checkManifest } from '../harness/mutation-shards.mjs';

export const MUTATION_EVIDENCE_PREFIX = 'FLUXION_MUTATION_EVIDENCE ';
const sha = (value, size) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const requireValue = (value, message) => {
  if (!value) throw new Error(message);
};
const duration = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3600000;

/** Source/test inputs, engine and floors; bookkeeping revisions and host-specific runner hashes differ. */
export function mutationScopeHash(manifest) {
  const plan = checkManifest(manifest);
  const mutants = plan.mutants.map((m) => [
    m.id,
    m.file,
    m.mutatorName,
    m.location.start.line,
    m.location.start.column,
    m.location.end.line,
    m.location.end.column,
    m.original,
    m.replacement,
  ]);
  mutants.sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha256')
    .update(JSON.stringify({ version: plan.version, packages: plan.packages, files: plan.files, mutants, floors: plan.floors }))
    .digest('hex');
}

export function mutationReceipt(manifest, shards) {
  const plan = checkManifest(manifest),
    result = aggregatePartitions(plan, shards);
  requireValue(result.ok, result.errors.join('; '));
  requireValue(
    shards.every((s) => duration(s.elapsedMs)),
    'missing or excessive partition execution duration',
  );
  return {
    schemaVersion: 1,
    revision: plan.revision,
    runner: plan.runner,
    scope: mutationScopeHash(plan),
    partitions: partitionManifest(plan).map((p) => p.id),
    scores: result.scores,
    maxElapsedMs: Math.max(...shards.map((s) => s.elapsedMs)),
  };
}

function receiptFrom(annotations) {
  requireValue(Array.isArray(annotations), 'missing annotations');
  const found = annotations.filter((a) => a.annotation_level === 'notice' && typeof a.message === 'string' && a.message.startsWith(MUTATION_EVIDENCE_PREFIX));
  requireValue(found.length === 1, 'missing or duplicate mutation evidence notice');
  return JSON.parse(found[0].message.slice(MUTATION_EVIDENCE_PREFIX.length));
}

function validateReceipt(receipt, plan, revision) {
  requireValue(receipt?.schemaVersion === 1 && receipt.revision === revision && sha(receipt.runner, 64), 'invalid receipt identity');
  requireValue(receipt.scope === mutationScopeHash(plan), 'mutation scope differs from current checkout');
  const parts = partitionManifest(plan).map((p) => p.id);
  requireValue(JSON.stringify(receipt.partitions) === JSON.stringify(parts), 'incomplete partition list');
  requireValue(duration(receipt.maxElapsedMs), 'invalid execution duration');
  requireValue(Array.isArray(receipt.scores) && receipt.scores.length === plan.packages.length, 'missing package scores');
  const seen = new Set();
  for (const score of receipt.scores) {
    requireValue(plan.packages.includes(score?.package) && !seen.has(score.package), 'unexpected or duplicate package score');
    seen.add(score.package);
    const total = plan.mutants.filter((m) => m.file.startsWith(`${score.package}/src/`)).length;
    requireValue(score.total === total && Number.isInteger(score.valid) && score.valid > 0 && score.valid <= total, 'invalid package mutant counts');
    requireValue(
      score.floor === plan.floors[score.package] && Number.isFinite(score.score) && score.score >= score.floor && score.score <= 100,
      'package score or floor failed',
    );
  }
}

function validateJobs(jobs, partitions) {
  requireValue(Array.isArray(jobs), 'missing jobs');
  const required = new Map([
    ['mutation-plan', 'Create complete mutation plan'],
    ['mutation', 'Validate complete mutation reports'],
    ...partitions.map((id) => [`mutation (${id})`, 'Execute complete mutation partition']),
  ]);
  const relevant = jobs.filter((j) => j.name === 'mutation' || j.name === 'mutation-plan' || j.name?.startsWith('mutation ('));
  requireValue(relevant.length === required.size, 'missing or duplicate mutation jobs');
  for (const [name, step] of required) {
    const found = relevant.filter((j) => j.name === name);
    requireValue(found.length === 1, `missing or duplicate job ${name}`);
    const job = found[0];
    requireValue(job.status === 'completed' && job.conclusion === 'success' && job.run_attempt === 1, `failed, unfinished or retried job ${name}`);
    const steps = (job.steps ?? []).filter((s) => s.name === step);
    requireValue(steps.length === 1 && steps[0].conclusion === 'success', `missing or skipped execution step ${name}`);
  }
}

/** Unrelated nightly failures do not replace the complete successful mutation job set. */
export function validateMutationEvidence(evidence, manifest, revision) {
  try {
    const plan = checkManifest(manifest),
      run = evidence?.run;
    requireValue(sha(revision, 40) && run?.head_sha === revision && Number.isSafeInteger(run.id) && run.id > 0, 'invalid run revision');
    requireValue(
      run.name === 'nightly' && run.path === '.github/workflows/nightly.yml' && run.status === 'completed' && run.run_attempt === 1,
      'wrong, unfinished or retried nightly run',
    );
    const receipt = receiptFrom(evidence.annotations);
    validateReceipt(receipt, plan, revision);
    validateJobs(evidence.jobs, receipt.partitions);
    return { ok: true, receipt, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
