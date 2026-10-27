// NFR-MNT-005: partition expected sources; derive scores only from complete package unions.
import { checkManifest, hasValidMutants, scoreMutants, validateShard } from './mutation-shards.mjs';

export const DEFAULT_PARTITION_TARGET = 50;
/** GitHub's cap on the jobs one matrix expands to. */
export const MATRIX_JOBS_MAX = 256;
/** Chained partition jobs in nightly.yml (`mutation-partitions`, `mutation-partitions-2`), one matrix each (ADR-0198). */
export const MATRIX_CHAINS = 2;

/**
 * Partitions in plan order split into the fewest matrices of at most `max` jobs, as evenly as possible. Throws when even
 * `chains` matrices cannot hold them all: the plan never drops a partition to fit.
 */
export function matrixChains(parts, chains = MATRIX_CHAINS, max = MATRIX_JOBS_MAX) {
  const used = Math.max(1, Math.ceil(parts.length / max));
  if (used > chains) throw new Error(`mutation matrix needs ${parts.length} jobs, over ${chains} chained matrices of ${max}; no scope was dropped`);
  const size = Math.ceil(parts.length / used);
  return Array.from({ length: used }, (_, i) => parts.slice(i * size, (i + 1) * size));
}

/** The target schedules whole files; it never drops mutants from an oversized file. */
export function partitionManifest(manifest, target = DEFAULT_PARTITION_TARGET) {
  const plan = checkManifest(manifest);
  if (!Number.isSafeInteger(target) || target < 1) throw new Error('invalid partition target');
  const counts = new Map();
  for (const mutant of plan.mutants) counts.set(mutant.file, (counts.get(mutant.file) ?? 0) + 1);
  return plan.packages.flatMap((pkg) => {
    const bins = [];
    const files = Object.keys(plan.files).filter((f) => f.startsWith(`${pkg}/src/`));
    files.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
    for (const file of files) {
      const count = counts.get(file) ?? 0;
      let bin = bins.find((b) => count === 0 || b.mutants + count <= target);
      if (!bin) {
        bin = { id: `${pkg.slice('packages/'.length)}-${bins.length + 1}`, package: pkg, files: [], mutants: 0 };
        bins.push(bin);
      }
      bin.files.push(file);
      bin.mutants += count;
    }
    for (const bin of bins) bin.files.sort();
    return bins;
  });
}

/** Validate each raw report against its exact expected subset, without a partial-package floor. */
export function validatePartition(plan, partition, shard) {
  if (shard?.partition !== partition.id || shard.package !== partition.package) throw new Error('partition identity mismatch');
  const files = new Set(partition.files);
  const mutants = validateShard({ ...plan, mutants: plan.mutants.filter((m) => files.has(m.file)) }, shard);
  if (!hasValidMutants(mutants) && mutants.some((mutant) => mutant.status !== 'CompileError'))
    throw new Error('zero-valid partition contains runtime errors or ignored mutants');
  return mutants;
}

/** This is a derived summary; the input engine reports remain separate raw artifacts. */
export function aggregatePartitions(manifest, shards, target = DEFAULT_PARTITION_TARGET) {
  const errors = [],
    scores = [];
  try {
    const plan = checkManifest(manifest);
    const parts = partitionManifest(plan, target);
    if (!Array.isArray(shards)) throw new Error('missing partition reports');
    const expected = new Map(parts.map((p) => [p.id, p]));
    const seen = new Set(),
      mutants = new Map(plan.packages.map((p) => [p, []]));
    for (const shard of shards) {
      const part = expected.get(shard?.partition);
      if (!part || seen.has(part.id)) throw new Error('unexpected or duplicate partition');
      seen.add(part.id);
      mutants.get(part.package).push(...validatePartition(plan, part, shard));
    }
    for (const part of parts) if (!seen.has(part.id)) throw new Error(`missing partition: ${part.id}`);
    for (const pkg of plan.packages) {
      const score = scoreMutants(plan, pkg, mutants.get(pkg));
      scores.push(score);
      if (score.score < score.floor) errors.push(`${pkg}: ${score.score.toFixed(1)} % < ${score.floor} %`);
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors, scores: scores.sort((a, b) => a.package.localeCompare(b.package)) };
}
