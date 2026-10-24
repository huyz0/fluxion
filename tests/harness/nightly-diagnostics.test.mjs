// HARNESS: exercise the nightly commands' real reporters with deliberately failing tests.
// These probes never supply browser correctness or performance evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { cleanEnv, out, REPO, sandbox } from './helpers.mjs';

const require = createRequire(import.meta.url);
// The same suite can verify the nightly's older runner without changing repository dependencies.
const runner = process.env.FLUXION_DIAGNOSTICS_PLAYWRIGHT_ROOT ?? dirname(require.resolve('@playwright/test/package.json'));
const workflow = readFileSync(join(REPO, '.github/workflows/nightly.yml'), 'utf8');
const section = (job) => new RegExp(`^ {2}${job}:[\\s\\S]*?(?=^ {2}\\S)`, 'm').exec(workflow)?.[0] ?? '';
const previous = [...section('previous-playwright').matchAll(/- browser: (\S+)\s+mobile: (\S+)/g)];
assert.equal(previous.length, 3, 'probe every previous-browser matrix entry');

const cases = [
  { job: 'perf', marker: 'perf', count: 1 },
  { job: 'visual-xos', marker: 'visual', count: 1 },
  ...previous.map(([, browser, mobile]) => ({ job: 'previous-playwright', marker: 'browser', browser, mobile, count: new Set([browser, mobile]).size })),
];

function writeProbe(sb) {
  const names = ['perf', 'chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'];
  sb.write(
    'playwright.config.mjs',
    `export default {testDir:'.',testMatch:'probe.spec.mjs',retries:1,workers:1,projects:${JSON.stringify(names)}.map(name=>({name,...(name==='perf'?{grep:/@perf/}:{grepInvert:/@perf/})}))};\n`,
  );
  sb.write(
    'probe.spec.mjs',
    `import {test,expect} from ${JSON.stringify(pathToFileURL(join(runner, 'index.mjs')).href)};\n` +
      ['perf', 'visual', 'browser']
        .map(
          (marker) =>
            `test('HARNESS ${marker === 'browser' ? '' : `@${marker}`} ${marker} diagnostic probe',()=>expect('actual-${marker}').toBe('expected-${marker}'));`,
        )
        .join('\n'),
  );
}

function checkResult(result, report, entry) {
  assert.equal(result.status, 1, out(result));
  const annotations = result.stdout.split('\n').filter((line) => line.startsWith('::error ') || line.startsWith('::error::'));
  assert.ok(
    annotations.some(
      (line) => line.includes(`${entry.marker} diagnostic probe`) && line.includes(`actual-${entry.marker}`) && line.includes(`expected-${entry.marker}`),
    ),
    out(result),
  );
  assert.equal(report.stats.unexpected, entry.count, 'the workflow selectors must run the intended probe projects');
  assert.equal(report.stats.flaky, 0);
  const tests = (suite) => [...(suite.specs ?? []).flatMap((spec) => spec.tests), ...(suite.suites ?? []).flatMap(tests)];
  const results = report.suites.flatMap(tests);
  assert.equal(results.length, entry.count);
  for (const test of results) {
    assert.equal(test.results.length, 1, 'zero retries, even though the probe config defaults to one');
    assert.equal(test.results[0].status, 'failed');
    assert.match(JSON.stringify(test.results[0].errors), new RegExp(`expected-${entry.marker}`));
  }
}

describe('nightly failure diagnostics (HARNESS)', () => {
  for (const entry of cases) {
    it(`HARNESS: ${entry.job} ${entry.browser ?? ''} exposes assertion details and JSON with one failed attempt`, () => {
      const job = section(entry.job);
      const command = /^ {6}- run: pnpm exec playwright (test .+)$/m.exec(job)?.[1];
      assert.ok(command, 'the tested command must come from the workflow');
      const output = /^ {10}PLAYWRIGHT_JSON_OUTPUT_NAME: (\S+)$/m.exec(job)?.[1];
      assert.equal(output, 'test-results/e2e.json');
      const args = command
        .replaceAll('$BROWSER', entry.browser ?? '')
        .replaceAll('$MOBILE', entry.mobile ?? '')
        .split(/\s+/)
        .map((arg) => arg.replaceAll('"', ''));
      const sb = sandbox([]);
      try {
        writeProbe(sb);
        const result = spawnSync(process.execPath, [join(runner, 'cli.js'), ...args, '--config', sb.path('playwright.config.mjs')], {
          cwd: sb.dir,
          encoding: 'utf8',
          timeout: 60_000,
          env: cleanEnv({ ...process.env, GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: sb.dir, PLAYWRIGHT_JSON_OUTPUT_NAME: output, FORCE_COLOR: '0' }),
        });
        checkResult(result, JSON.parse(sb.read(output)), entry);
      } finally {
        sb.cleanup();
      }
    });
  }
});
