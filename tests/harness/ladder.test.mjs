// NFR-DX-002: the pre-commit ladder overlaps independent steps without changing what it reports.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { failureAnnotation } from '../../scripts/gates/failure-report.mjs';
import { nestedSkip, run, runAsync } from '../../scripts/gates/lib.mjs';
import { out, sandbox, TRANSIENT } from './helpers.mjs';

describe('pre-commit ladder concurrency (NFR-DX-002, M1.28)', () => {
  it('runAsync returns what run returns: status, stdout and stderr', async () => {
    const cases = [
      [process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err')"]],
      [process.execPath, ['-e', 'process.exit(3)']],
      // ~600 kB of multi-byte characters: chunk boundaries fall inside characters (M1.28 review F1)
      [process.execPath, ['-e', "process.stdout.write('é—'.repeat(120000))"]],
    ];
    for (const [cmd, args] of cases) assert.deepEqual(await runAsync(cmd, args), run(cmd, args));
  });

  it('sandboxes do not copy build state that concurrent steps rewrite (M1.33)', () => {
    const sb = sandbox(['packages/core']);
    try {
      for (const p of ['.tsbuild', 'node_modules', 'coverage']) assert.equal(existsSync(sb.path(`packages/core/${p}`)), false, p);
      assert.ok(existsSync(sb.path('packages/core/src/index.ts')));
    } finally {
      sb.cleanup();
    }
    for (const p of ['packages/core/.tsbuild/x.tsbuildinfo', 'packages/core/node_modules/a/b.js', 'packages/core/fluxion-core-0.0.0.tgz']) {
      assert.match(p.replaceAll('/', '\\'), TRANSIENT, p);
      assert.match(`/repo/${p}`, TRANSIENT, p);
    }
    for (const p of ['packages/core/src/tsbuild.ts', 'packages/core/dist/index.js']) assert.doesNotMatch(`/repo/${p}`, TRANSIENT, p);
  });

  it('a tool that exits 0 but reports its own SKIP prints as SKIP, not PASS (M1.19, M1 cp1 F3)', () => {
    assert.equal(nestedSkip('actionlint: 0 findings\nworkflows: SKIP — Docker not available\n'), 'Docker not available');
    assert.equal(nestedSkip('workflows: 3 files linted\n'), null);
    const sb = sandbox();
    try {
      sb.write('.github/workflows/ci.yml', 'name: ci\n');
      sb.write('scripts/gates/check-workflows.mjs', "console.log('workflows: SKIP — Docker not available');\n");
      const r = sb.node('scripts/gates/precommit.mjs', ['--all', '--summary']);
      assert.match(r.stdout, /^SKIP workflows — Docker not available$/m, out(r));
      assert.doesNotMatch(r.stdout, /^PASS workflows/m);
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-DX-003: successful gates retain advisory lines and escaped warnings even in summaries', () => {
    for (const summary of [false, true]) {
      const sb = sandbox();
      try {
        sb.write('.github/workflows/ci.yml', 'name: ci\n');
        sb.write('scripts/gates/check-workflows.mjs', "console.log('ADVISORY embedding target 150112 > 150000 %0A::error::inert');\n");
        const args = ['--all', ...(summary ? ['--summary'] : [])];
        const result = sb.node('scripts/gates/precommit.mjs', args, { env: { ...process.env, GITHUB_ACTIONS: 'true' } });
        assert.match(result.stdout, /^PASS workflows/m, out(result));
        assert.match(result.stdout, /^ADVISORY embedding target 150112 > 150000 %0A::error::inert$/m);
        assert.match(result.stdout, /::warning::Advisory target exceeded: workflows%0AADVISORY.*%250A::error::inert/);
        assert.doesNotMatch(result.stdout, /^::error::/m);
      } finally {
        sb.cleanup();
      }
    }
  });

  for (const { summary, fail, status, label } of [
    { summary: false, fail: false, status: 0, label: 'PASS' },
    { summary: false, fail: true, status: 1, label: 'FAIL' },
    { summary: true, fail: false, status: 0, label: 'PASS' },
    { summary: true, fail: true, status: 1, label: 'FAIL' },
  ]) {
    it(`NFR-DX-002 NFR-DX-003: quick overrun preserves status and warnings (summary=${summary}, fail=${fail})`, () => {
      const sb = sandbox();
      try {
        sb.write('clock.mjs', "let calls = 0; Date.now = () => calls++ === 0 ? 0 : 180001; await import('./scripts/gates/precommit.mjs');");
        sb.write(
          'scripts/gates/check-portability.mjs',
          fail ? "console.error('deliberate correctness failure'); process.exit(1);" : "console.log('portability ok');",
        );
        const r = sb.node('clock.mjs', ['--quick', '--no-budget', ...(summary ? ['--summary'] : [])], { env: { ...process.env, GITHUB_ACTIONS: 'true' } });
        assert.equal(r.status, status, out(r));
        assert.match(r.stdout, /^ADVISORY quick latency: 180001ms; target 180000ms; overrun 1ms/m);
        assert.match(r.stdout, /::warning::Advisory target exceeded: quick latency%0AADVISORY/);
        assert.match(r.stdout, new RegExp(`VERIFY quick: ${label}`));
      } finally {
        sb.cleanup();
      }
    });
  }

  it('a failing step shows its "failing tests" list even when the report is long (M1.39)', () => {
    const sb = sandbox();
    try {
      sb.write('.github/workflows/ci.yml', 'name: ci\n');
      const report =
        "console.log(['x'.repeat(10), '\\u2716 failing tests:', '\\u2716 the named test', ...Array(200).fill('  noise')].join('\\n')); process.exit(1);\n";
      sb.write('scripts/gates/check-workflows.mjs', report);
      const r = sb.node('scripts/gates/precommit.mjs', ['--all']);
      assert.match(r.stdout, /^FAIL workflows[^\n]*\n {4}✖ failing tests:\n {4}✖ the named test$/m, out(r));
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-DX-003: CI failures expose escaped diagnostics without changing exit status or full logs', () => {
    for (const summary of [false, true]) {
      const sb = sandbox();
      try {
        sb.write('.github/workflows/ci.yml', 'name: ci\n');
        const stdout = '\u001b[31m FAIL browser sample.test.ts > deliberate probe\u001b[0m\nExpected: 100%\nReceived: 0%\n';
        const stderr = 'Error: deliberate failure\r\n::warning::must remain data';
        sb.write(
          'scripts/gates/check-workflows.mjs',
          `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)}); process.exit(7);`,
        );
        const result = sb.node('scripts/gates/precommit.mjs', ['--all', ...(summary ? ['--summary'] : [])], {
          env: { ...process.env, GITHUB_ACTIONS: 'true' },
        });
        assert.equal(result.status, 1, out(result));
        const annotations = result.stdout.split('\n').filter((line) => line.startsWith('::error::'));
        assert.equal(annotations.length, 1, out(result));
        assert.match(annotations[0], /workflows.*deliberate probe.*Expected: 100%25.*Received: 0%25.*Error: deliberate failure/);
        assert.ok(annotations[0].includes('%0A::warning::must remain data'));
        assert.ok(!annotations[0].includes('\u001b'));
        assert.doesNotMatch(result.stdout, /^::warning::/m);
        assert.match(result.stdout, /^FAIL workflows/m);
        const escapedPath = /Full failure output: ([^%]+)/.exec(annotations[0])?.[1];
        assert.ok(escapedPath, out(result));
        const complete = sb.read(escapedPath);
        assert.ok(complete.includes(stdout));
        assert.ok(complete.includes(stderr));
      } finally {
        sb.cleanup();
      }
    }
  });

  it('NFR-DX-003: large annotations stay bounded and retain the complete-log pointer', () => {
    const annotation = failureAnnotation('test', ['x'.repeat(100000)], 'reports/complete.log');
    assert.ok(annotation.length < 17000);
    assert.match(annotation, /excerpt truncated/);
    assert.ok(annotation.endsWith('Full failure output: reports/complete.log'));
    assert.match(failureAnnotation('budget', ['FAIL budget']), /^::error::Verification failed: budget%0AFAIL budget$/);
  });

  it('Vitest failures retain every test heading and complete output (NFR-DX-003)', () => {
    const sb = sandbox();
    try {
      sb.write('.github/workflows/ci.yml', 'name: ci\n');
      const chunks = Array.from({ length: 4 }, (_, i) =>
        [`\u001b[31m FAIL browser file-${i}.test.ts > case-${i}\u001b[0m`, `Error: failure-${i}`, ...Array(80).fill(`detail-${i}`)].join('\n'),
      );
      sb.write(
        'scripts/gates/check-workflows.mjs',
        `process.stdout.write(${JSON.stringify(chunks.join('\n'))}); process.stderr.write('stderr preserved'); process.exit(1);\n`,
      );
      const r = sb.node('scripts/gates/precommit.mjs', ['--all']);
      assert.notEqual(r.status, 0, out(r));
      if (process.env.GITHUB_ACTIONS !== 'true') assert.doesNotMatch(r.stdout, /^::error::/m);
      for (let i = 0; i < 4; i++) {
        assert.ok(r.stdout.includes(`file-${i}.test.ts > case-${i}`), out(r));
        assert.ok(r.stdout.includes(`Error: failure-${i}`), out(r));
      }
      const log = /Full failure output: (.+)/.exec(r.stdout)?.[1];
      assert.ok(log, out(r));
      const complete = sb.read(log);
      for (let i = 0; i < 4; i++) assert.ok(complete.includes(`detail-${i}`));
      assert.ok(complete.includes('stderr preserved'));
    } finally {
      sb.cleanup();
    }
  });

  it('a failed fast-check property keeps its seed and counterexample in the FAIL detail (M4.31)', () => {
    const sb = sandbox();
    try {
      sb.write('.github/workflows/ci.yml', 'name: ci\n');
      const report =
        "console.log(['Error: Property failed after 12 tests', '{ seed: -1234567, path: \"11:0\", endOnFailure: true }', 'Counterexample: [\"x\",0]', ...Array(200).fill('  noise')].join('\\n')); process.exit(1);\n";
      sb.write('scripts/gates/check-workflows.mjs', report);
      const r = sb.node('scripts/gates/precommit.mjs', ['--all']);
      assert.match(
        r.stdout,
        /^FAIL workflows[^\n]*\n {4}Error: Property failed after 12 tests\n {4}\{ seed: -1234567, path: "11:0"[^\n]*\n {4}Counterexample: \["x",0\]\n {4} {2}noise$/m,
        out(r),
      );
    } finally {
      sb.cleanup();
    }
  });

  it('runAsync reports a missing command as a failure instead of throwing', async () => {
    const r = await runAsync('fluxion-no-such-command-xyz', []);
    assert.notEqual(r.status, 0);
  });

  it('prints every step once, in ladder order, although steps after build run concurrently', () => {
    const sb = sandbox();
    try {
      const r = sb.node('scripts/gates/precommit.mjs', ['--all', '--summary']);
      const order = [...sb.read('scripts/gates/precommit.mjs').matchAll(/^ {2}(?:\[|\[\n {4})?'([a-z-]+)',/gm)].map((m) => m[1]);
      const printed = [...r.stdout.matchAll(/^(?:PASS|FAIL|SKIP) ([a-z-]+)/gm)].map((m) => m[1]);
      assert.ok(printed.includes('build') && printed.includes('trace'), out(r));
      assert.deepEqual(
        printed,
        order.filter((n) => printed.includes(n)),
        out(r),
      );
      assert.equal(new Set(printed).size, printed.length, 'no step printed twice');
    } finally {
      sb.cleanup();
    }
  });
});
