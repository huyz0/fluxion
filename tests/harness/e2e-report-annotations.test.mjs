import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const files = ['scripts/ci', 'scripts/gates/failure-report.mjs', 'scripts/gates/lib.mjs'];
const report = (status, title = 'paints', errors = []) => ({
  suites: [{ title: 'artwork.spec.ts', specs: [{ title, tests: [{ projectName: 'webkit', status, results: [{ status: 'failed', retry: 0, errors }] }] }] }],
});
const run = (sb, value, ci = true) => {
  sb.write('merged.json', typeof value === 'string' ? value : JSON.stringify(value));
  return sb.node('scripts/ci/flake-report.mjs', [sb.path('merged.json')], { env: { ...process.env, GITHUB_ACTIONS: String(ci), GITHUB_STEP_SUMMARY: '' } });
};

describe('merged E2E diagnostics (NFR-DX-004)', () => {
  it('failed and flaky probes expose project, test and first-attempt errors without changing failure status', () => {
    const sb = sandbox(files);
    try {
      for (const status of ['unexpected', 'flaky']) {
        const r = run(sb, report(status, 'paints', [{ message: 'Expected red, received blue' }]));
        assert.equal(r.status, 1, out(r));
        const annotation = r.stdout.split('\n').find((line) => line.startsWith('::error::'));
        assert.ok(annotation, out(r));
        assert.match(annotation, /webkit.*artwork\.spec\.ts.*paints/);
        assert.match(annotation, /retry 0.*failed/);
        assert.match(annotation, /Expected red, received blue/);
      }
    } finally {
      sb.cleanup();
    }
  });

  it('escapes command payloads, strips ANSI and bounds annotations while retaining the input report', () => {
    const sb = sandbox(files);
    try {
      const original = JSON.stringify(
        report('unexpected', 'paints\n::warning::injected', [{ message: `\u001b[31mred%\r\n::notice::injected\u001b[0m${'x'.repeat(20000)}` }]),
      );
      const r = run(sb, original);
      assert.equal(r.status, 1, out(r));
      assert.equal(readFileSync(sb.path('merged.json'), 'utf8'), original);
      assert.doesNotMatch(r.stdout, /^::(?:warning|notice)::/m);
      const annotation = r.stdout.split('\n').find((line) => line.startsWith('::error::'));
      assert.ok(annotation, out(r));
      assert.match(annotation, /red%25%0D%0A::notice::/);
      assert.equal(annotation.includes(String.fromCharCode(27)), false);
      assert.match(annotation, /excerpt truncated/);
      assert.ok(annotation.length < 17000);
    } finally {
      sb.cleanup();
    }
  });

  it('empty, all-skipped, malformed and missing reports fail with annotations; passing or non-CI reports do not', () => {
    const sb = sandbox(files);
    try {
      for (const value of [{ suites: [] }, report('skipped'), '{bad json']) {
        const r = run(sb, value);
        assert.equal(r.status, 1, out(r));
        assert.match(r.stdout, /^::error::/m);
      }
      const missing = sb.node('scripts/ci/flake-report.mjs', [sb.path('missing.json')], {
        env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '' },
      });
      assert.equal(missing.status, 1, out(missing));
      assert.match(missing.stdout, /^::error::/m);
      const good = run(sb, report('expected'));
      assert.equal(good.status, 0, out(good));
      assert.doesNotMatch(good.stdout, /^::error::/m);
      const local = run(sb, report('flaky'), false);
      assert.equal(local.status, 1, out(local));
      assert.doesNotMatch(local.stdout, /^::error::/m);
      assert.match(local.stdout, /^FLAKY \[webkit\]/m);
    } finally {
      sb.cleanup();
    }
  });

  it('uploads complete merged JSON and HTML after checker failures with unchanged artifact retention', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    const job = /^ {2}e2e-report:[\s\S]*?(?=^ {2}\S)/m.exec(workflow)?.[0] ?? '';
    assert.match(job, /PLAYWRIGHT_JSON_OUTPUT_NAME: merged\.json/);
    assert.match(job, /if: \$\{\{ !cancelled\(\) \}\}[\s\S]*?name: e2e-html-report\n\s+path: \|\n\s+playwright-report\n\s+merged\.json\n\s+retention-days: 14/);
  });
});
