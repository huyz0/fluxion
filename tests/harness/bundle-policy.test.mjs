// NFR-SIZE-001/002, NFR-DX-003: explicit advisories never hide missing measurements or hard failures.
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { delimiter } from 'node:path';
import { describe, it } from 'node:test';
import { judgeBundleReport } from '../../scripts/gates/check-bundle-size.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';
import { out, sandbox } from './helpers.mjs';

const report = () => [
  { name: 'player core', passed: true, size: 88958, sizeLimit: 150000 },
  { name: 'player-inline', passed: true, size: 148636, sizeLimit: 150000 },
  { name: 'fluxion-player script', passed: true, size: 149877, sizeLimit: 150000 },
  { name: 'editor initial', passed: true, size: 436404, sizeLimit: 600000 },
];

describe('ADR-0176 bundle policy', () => {
  it('NFR-SIZE-001: keeps all measurements and marks only embedding artifacts advisory', () => {
    const input = report();
    const copy = structuredClone(input);
    const result = judgeBundleReport(input, 0, '');
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.results.map((r) => [r.name, r.advisory, r.size, r.sizeLimit]),
      [
        ['player core', false, 88958, 150000],
        ['player-inline', true, 148636, 150000],
        ['fluxion-player script', true, 149877, 150000],
        ['editor initial', false, 436404, 600000],
      ],
    );
    assert.deepEqual(input, copy);
  });
  it('NFR-SIZE-001: embedding overruns remain explicitly failed targets without blocking', () => {
    const input = report();
    for (const i of [1, 2]) Object.assign(input[i], { size: 150112, passed: false });
    const result = judgeBundleReport(input, 1, '');
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.results.filter((r) => !r.passed).map((r) => [r.name, r.overrun, r.advisory]),
      [
        ['player-inline', 112, true],
        ['fluxion-player script', 112, true],
      ],
    );
    assert.equal(input[2].passed, false);
  });
  it('NFR-SIZE-001/002: one-byte hard overruns still fail beside an advisory overrun', () => {
    for (const index of [0, 3]) {
      const input = report();
      Object.assign(input[2], { size: 150112, passed: false });
      Object.assign(input[index], { size: input[index].sizeLimit + 1, passed: false });
      const result = judgeBundleReport(input, 1, '');
      assert.equal(result.ok, false);
      assert.equal(result.results[index].overrun, 1);
      assert.equal(result.results[index].advisory, false);
    }
  });
  it('NFR-DX-003: rejects missing, duplicate, unknown and malformed measurement sets', () => {
    const inputs = [null, {}, [], report().slice(1), [...report(), report()[0]], report().map((r, i) => (i === 1 ? { ...r, name: 'unknown' } : r))];
    for (const patch of [
      { size: NaN },
      { size: Infinity },
      { size: -1 },
      { size: 1.5 },
      { size: '1' },
      { sizeLimit: 150001 },
      { passed: false },
      { passed: 'true' },
    ])
      inputs.push(report().map((r, i) => (i === 0 ? { ...r, ...patch } : r)));
    for (const input of inputs) assert.throws(() => judgeBundleReport(input, 0, ''), /bundle/);
  });
  it('NFR-DX-003: unexpected tool failures and contradictory exit statuses fail closed', () => {
    for (const code of [1, 2, null, -1]) assert.throws(() => judgeBundleReport(report(), code, ''), /bundle/);
    const input = report();
    Object.assign(input[2], { size: 150112, passed: false });
    assert.throws(() => judgeBundleReport(input, 0, ''), /bundle/);
    assert.throws(() => judgeBundleReport(input, 2, ''), /bundle/);
    assert.throws(() => judgeBundleReport(input, 1, 'unexpected measurement failure'), /bundle/);
  });
  it('NFR-MNT-005: uses the reviewed core target and leaves the default floor unchanged', () => {
    const baseline = JSON.parse(readFileSync(new URL('../../.harness/baselines/mutation.json', import.meta.url), 'utf8'));
    assert.equal(baseline.packages['packages/core'].score, 90);
    assert.equal(baseline.packages['packages/core'].score, t('MUTATION_CORE_TARGET'));
    assert.equal(t('MUTATION_PURE_SCORE'), 70);
    assert.deepEqual(Object.keys(baseline.packages), ['packages/core']);
  });
});

it('NFR-DX-003: CLI probes preserve raw failures, report advisories and invalidate stale results', () => {
  const sb = sandbox(['scripts/gates/check-bundle-size.mjs', 'scripts/gates/lib.mjs', 'scripts/gates/thresholds.mjs']);
  try {
    sb.write(
      'bin/fake-pnpm.mjs',
      `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.deepEqual(process.argv.slice(2), ['exec', 'size-limit', '--json']);
const value = JSON.parse(readFileSync('measurement.json', 'utf8'));
process.stdout.write(value.stdout); process.stderr.write(value.stderr); process.exitCode = value.exit;
`,
    );
    sb.write('bin/pnpm', `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-pnpm.mjs" "$@"\n`);
    chmodSync(sb.path('bin/pnpm'), 0o755);
    sb.write('bin/pnpm.cmd', `@"${process.execPath}" "%~dp0fake-pnpm.mjs" %*\r\n`);
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, [pathKey]: `${sb.path('bin')}${delimiter}${process.env[pathKey] ?? ''}` };
    const input = report();
    Object.assign(input[2], { size: 150112, passed: false });
    sb.write('measurement.json', JSON.stringify({ stdout: JSON.stringify(input), stderr: '', exit: 1 }));
    const advisory = sb.node('scripts/gates/check-bundle-size.mjs', [], { env });
    assert.equal(advisory.status, 0, out(advisory));
    assert.match(advisory.stdout, /ADVISORY fluxion-player script: 150112 bytes; advisory target 150000; overrun 112/);
    assert.deepEqual(JSON.parse(sb.read('.harness/artifacts/bundle-size.json')).raw, input);
    assert.equal(sb.read('.harness/artifacts/size-limit.stdout.log'), JSON.stringify(input));
    Object.assign(input[0], { size: 150001, passed: false });
    sb.write('measurement.json', JSON.stringify({ stdout: JSON.stringify(input), stderr: '', exit: 1 }));
    const hard = sb.node('scripts/gates/check-bundle-size.mjs', [], { env });
    assert.equal(hard.status, 1, out(hard));
    assert.match(hard.stdout, /FAIL player core: 150001 bytes; hard limit 150000; overrun 1/);
    assert.equal(JSON.parse(sb.read('.harness/artifacts/bundle-size.json')).ok, false);
    sb.write('measurement.json', JSON.stringify({ stdout: '{broken', stderr: 'measurement failed', exit: 2 }));
    const broken = sb.node('scripts/gates/check-bundle-size.mjs', [], { env });
    assert.equal(broken.status, 1, out(broken));
    assert.deepEqual(JSON.parse(sb.read('.harness/artifacts/bundle-size.json')), { valid: false, toolExit: 2 });
    assert.equal(sb.read('.harness/artifacts/size-limit.stdout.log'), '{broken');
    assert.equal(sb.read('.harness/artifacts/size-limit.stderr.log'), 'measurement failed');
  } finally {
    sb.cleanup();
  }
});

it('NFR-SIZE-001: CI size job uses the shared policy and retains raw measurements on failure', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = ci.slice(ci.indexOf('\n  size:\n'), ci.indexOf('\n  api:\n'));
  assert.match(job, /run: node scripts\/gates\/check-bundle-size\.mjs/);
  assert.doesNotMatch(job, /run: pnpm exec size-limit/);
  assert.match(job, /if: always\(\)[\s\S]*uses: actions\/upload-artifact@/);
  for (const file of ['bundle-size.json', 'size-limit.stdout.log', 'size-limit.stderr.log']) assert.ok(job.includes(file), file);
});
