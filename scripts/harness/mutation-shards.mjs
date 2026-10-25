// NFR-MNT-005: scope comes from the checkout inventory, never from whichever reports arrived.
import { createHash } from 'node:crypto';
import { t } from '../gates/thresholds.mjs';

const valid = new Set(['Killed', 'Timeout', 'Survived', 'NoCoverage']);
const invalid = new Set(['CompileError', 'RuntimeError', 'Ignored']);
const sha = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const under = (file, pkg) => file.startsWith(`${pkg}/src/`) && !file.split('/').some((part) => part === '..' || part === '.');
const sorted = (entries) => Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function identity(mutant) {
  requireValue(object(mutant) && typeof mutant.id === 'string' && mutant.id.length > 0, 'invalid mutant identity');
  for (const key of ['file', 'mutatorName', 'original', 'replacement']) requireValue(typeof mutant[key] === 'string', `invalid mutant ${key}`);
  const location = ['start', 'end'].map((key) => {
    const point = mutant.location?.[key];
    requireValue(Number.isInteger(point?.line) && point.line > 0 && Number.isInteger(point?.column) && point.column >= 0, 'invalid mutant location');
    return [point.line, point.column];
  });
  return [mutant.id, mutant.file, mutant.mutatorName, location, mutant.original, mutant.replacement];
}

function inventory(mutants, packages, files) {
  requireValue(Array.isArray(mutants), 'missing mutant inventory');
  const ids = new Set();
  for (const mutant of mutants) {
    identity(mutant);
    requireValue(!ids.has(mutant.id), `duplicate mutant ${mutant.id}`);
    requireValue(packages.some((pkg) => under(mutant.file, pkg)) && Object.hasOwn(files, mutant.file), `unexpected mutant source ${mutant.file}`);
    ids.add(mutant.id);
  }
  return mutants;
}

function checkedFiles(files, packages) {
  requireValue(object(files), 'missing source inventory');
  for (const [file, hash] of Object.entries(files)) {
    requireValue(packages.some((pkg) => under(file, pkg)) && sha(hash, 64), `invalid source evidence ${file}`);
  }
  for (const pkg of packages)
    requireValue(
      Object.keys(files).some((file) => under(file, pkg)),
      `missing sources for ${pkg}`,
    );
  return sorted(Object.entries(files));
}

/** Build expected scope from an independently collected checkout inventory and existing floors. */
export function createManifest({ revision, runner, version, packages, files, mutants, floors }) {
  requireValue(sha(revision, 40) && sha(runner, 64), 'invalid revision or runner fingerprint');
  requireValue(typeof version === 'string' && version.length > 0, 'missing mutation engine version');
  requireValue(Array.isArray(packages) && packages.length > 0 && new Set(packages).size === packages.length, 'missing or duplicate packages');
  requireValue(
    packages.every((pkg) => typeof pkg === 'string' && /^packages\/[a-z0-9-]+$/.test(pkg)),
    'invalid package',
  );
  requireValue(object(floors), 'invalid floors');
  const names = [...packages].sort();
  const sources = checkedFiles(files, names);
  const limits = names.map((pkg) => {
    const recorded = Object.hasOwn(floors, pkg) ? floors[pkg]?.score : t('MUTATION_PURE_SCORE');
    requireValue(typeof recorded === 'number' && Number.isFinite(recorded) && recorded >= 0 && recorded <= 100, `invalid floor ${pkg}`);
    return [pkg, Math.max(recorded, t('MUTATION_PURE_SCORE'))];
  });
  inventory(mutants, names, sources);
  return { schemaVersion: 1, revision, runner, version, packages: names, files: sources, mutants, floors: Object.fromEntries(limits) };
}

function checkManifest(manifest) {
  requireValue(manifest?.schemaVersion === 1 && object(manifest.floors), 'invalid manifest');
  const floors = Object.fromEntries(Object.entries(manifest.floors).map(([pkg, score]) => [pkg, { score }]));
  const checked = createManifest({ ...manifest, floors });
  requireValue(equal(checked.floors, manifest.floors), 'manifest floors differ from applicable floors');
  return checked;
}

function checkReport(manifest, shard) {
  const report = shard.report;
  requireValue(report?.schemaVersion === 1 && report.tzapVersion === manifest.version, 'invalid report version');
  requireValue(report.config?.scope === 'full' && equal(report.config.mutators, ['all']), 'reduced mutation scope');
  requireValue(Array.isArray(report.redTests) && report.redTests.length === 0, 'failed baseline tests');
  requireValue(Array.isArray(report.tests) && report.tests.length > 0, 'missing executed tests');
  requireValue(
    report.tests.every((test) => typeof test?.id === 'string' && test.id.length > 0),
    'malformed executed tests',
  );
  const expected = manifest.mutants.filter((m) => under(m.file, shard.package));
  const actual = inventory(report.mutants, [shard.package], shard.files);
  const fingerprints = (items) =>
    sorted(
      items.map((m) => [
        m.id,
        createHash('sha256')
          .update(JSON.stringify(identity(m)))
          .digest('hex'),
      ]),
    );
  requireValue(equal(fingerprints(actual), fingerprints(expected)), 'incomplete or changed mutant inventory');
  for (const mutant of actual) requireValue(valid.has(mutant.status) || invalid.has(mutant.status), `unfinished mutant ${mutant.id}`);
  return actual;
}

function checkShard(manifest, shard) {
  requireValue(shard?.schemaVersion === 1 && shard.exitCode === 0, 'failed or malformed shard');
  requireValue(shard.revision === manifest.revision && shard.runner === manifest.runner, 'revision or runner mismatch');
  const files = sorted(Object.entries(manifest.files).filter(([file]) => under(file, shard.package)));
  requireValue(equal(checkedFiles(shard.files, [shard.package]), files), 'source inventory mismatch');
  const mutants = checkReport(manifest, shard);
  const count = mutants.filter((m) => valid.has(m.status)).length;
  requireValue(count > 0, 'no valid mutants to score');
  const killed = mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
  return { package: shard.package, valid: count, total: mutants.length, score: (100 * killed) / count, floor: manifest.floors[shard.package] };
}

/** Reject incomplete/failed shards and recompute each package score against the expected floors. */
export function aggregateShards(manifest, shards) {
  const errors = [];
  const scores = [];
  try {
    const expected = checkManifest(manifest);
    requireValue(Array.isArray(shards), 'missing shards');
    const seen = new Set();
    for (const shard of shards) {
      requireValue(expected.packages.includes(shard?.package) && !seen.has(shard.package), 'unexpected or duplicate shard');
      seen.add(shard.package);
      const score = checkShard(expected, shard);
      scores.push(score);
      if (score.score < score.floor) errors.push(`${score.package}: ${score.score.toFixed(1)} % < ${score.floor} %`);
    }
    for (const pkg of expected.packages) if (!seen.has(pkg)) errors.push(`missing shard: ${pkg}`);
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors, scores: scores.sort((a, b) => a.package.localeCompare(b.package)) };
}
