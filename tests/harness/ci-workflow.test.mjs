// NFR-PORT-005 / NFR-SEC-005: the gates workflow runs the local gate definitions on three OSes
// with SHA-pinned actions, and re-checks every commit. Structural check (no YAML dependency).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const wf = readFileSync(join(REPO, '.github/workflows/gates.yml'), 'utf8');

describe('gates workflow (NFR-PORT-005)', () => {
  it('runs on ubuntu, windows and macos', () => {
    assert.match(wf, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  });

  it('pins every action to a full commit SHA (NFR-SEC-005)', () => {
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 2);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `unpinned action ${u}`);
  });

  it('runs the same gate scripts as the local hooks', () => {
    assert.match(wf, /node scripts\/gates\/precommit\.mjs --all/);
    assert.match(wf, /node --test "tests\/harness\/\*\.test\.mjs"/);
    assert.match(wf, /node scripts\/gates\/check-commits\.mjs --range/);
  });

  it('never cancels or replaces push runs (each push range must be checked)', () => {
    const c = /concurrency:[\s\S]*?cancel-in-progress:\s*(.+)/.exec(wf)?.[1].trim();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression, not a JS template
    assert.equal(c, "${{ github.event_name == 'pull_request' }}");
    // a shared group lets GitHub replace a pending push run; pushes are grouped per SHA
    const g = /concurrency:\s*\n\s*group:\s*(.+)/.exec(wf)?.[1].trim();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression, not a JS template
    assert.equal(g, "gates-${{ github.event_name == 'pull_request' && github.ref || github.sha }}");
  });

  it('grants read-only token permissions', () => {
    assert.match(wf, /^permissions:\n {2}contents: read$/m);
  });
});

describe('check-commits (NFR-DX-004)', () => {
  it('fails a commit that bypassed the commit-msg hook, passes a justified one', () => {
    const sb = sandbox(['scripts', 'docs/backlog'], { git: true });
    try {
      const base = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('tests/harness/x.test.mjs', "it('a', () => {});\n");
      sb.git('add', '-A');
      sb.git('commit', '-q', '--no-verify', '-m', 'M0.12: test: add x');
      sb.git('rm', '-q', 'tests/harness/x.test.mjs');
      sb.git('commit', '-q', '--no-verify', '-m', 'M0.12: test: drop x');
      const bad = sb.node('scripts/gates/check-commits.mjs', ['--range', `${base}..HEAD`]);
      assert.equal(bad.status, 1, out(bad));
      assert.match(bad.stdout, /FAIL \w+ M0\.12: test: drop x[\s\S]*tests-kept/);
      sb.git('commit', '-q', '--amend', '--no-verify', '-m', 'M0.12: test: drop x', '-m', 'Removes-test: obsolete fixture');
      const good = sb.node('scripts/gates/check-commits.mjs', ['--range', `${base}..HEAD`]);
      assert.equal(good.status, 0, out(good));
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a malformed range', () => {
    const sb = sandbox(['scripts'], { git: true });
    try {
      assert.equal(sb.node('scripts/gates/check-commits.mjs', ['--range', 'nope']).status, 2);
    } finally {
      sb.cleanup();
    }
  });
});

// ci.yml (M1.20): the job set of ci-cd.md section 3, gated by one required check
const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
const jobsOf = (text) => [...(/^jobs:\s*\n([\s\S]*)/m.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);

/** Non-blank, non-comment lines of the `run: |` block starting at line i (0 when line i is not one). */
function runBlockLength(lines, i) {
  const m = /^(\s*)(?:- )?run: \|\s*$/.exec(lines[i]);
  if (!m) return 0;
  let n = 0;
  for (let k = i + 1; k < lines.length && (lines[k].trim() === '' || lines[k].search(/\S/) > m[1].length + 2); k++) {
    if (lines[k].trim() && !lines[k].trim().startsWith('#')) n++;
  }
  return n;
}

describe('ci workflow (NFR-PORT-005, NFR-SEC-005)', () => {
  it('has the planned job set and ci-ok needs every other job (NFR-PORT-005)', () => {
    const jobs = jobsOf(ci);
    for (const j of ['verify', 'build', 'e2e', 'e2e-report', 'visual', 'a11y', 'size', 'api', 'license', 'eval-recorded', 'ci-ok'])
      assert.ok(jobs.includes(j), j);
    const needs = /^ {2}ci-ok:[\s\S]*?needs:\s*\[([^\]]*)\]/m
      .exec(ci)[1]
      .split(',')
      .map((s) => s.trim());
    assert.deepEqual(needs.toSorted(), jobs.filter((j) => j !== 'ci-ok').toSorted());
    assert.match(/^ {2}ci-ok:[\s\S]*?(?=^ {2}\S|(?![\s\S]))/m.exec(ci)[0], /if: always\(\)/, 'ci-ok must run when a dependency failed');
  });

  it('verifies on three OSes and shards e2e over three engines x 4 in the pinned image (NFR-PORT-005)', () => {
    assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    assert.match(ci, /browser: \[chromium, firefox, webkit\]\n\s+shard: \[1, 2, 3, 4\]/);
    const images = [...ci.matchAll(/image:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(images.length >= 3, 'e2e, visual and a11y run in the Playwright image');
    const pw = JSON.parse(readFileSync(join(REPO, 'node_modules/@playwright/test/package.json'), 'utf8')).version;
    // the image tag is the installed Playwright version: browsers and test runner must match
    for (const i of images) assert.ok(i.startsWith(`mcr.microsoft.com/playwright:v${pw}-noble@sha256:`) && /@sha256:[0-9a-f]{64}$/.test(i), i);
  });

  it('pins every action in every workflow to a full commit SHA (NFR-SEC-005)', () => {
    for (const name of ['ci.yml', 'gates.yml']) {
      const text = readFileSync(join(REPO, '.github/workflows', name), 'utf8');
      for (const [, u] of text.matchAll(/uses:\s*(\S+)/g)) assert.match(u, /@[0-9a-f]{40}$/, `${name}: unpinned action ${u}`);
    }
    assert.match(ci, /^permissions:\n {2}contents: read$/m);
    assert.doesNotMatch(ci, /id-token:/);
  });

  it('has no long inline scripts: a run block is at most 3 lines (NFR-PORT-005)', () => {
    for (const name of ['ci.yml', 'gates.yml']) {
      const lines = readFileSync(join(REPO, '.github/workflows', name), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const n = runBlockLength(lines, i);
        assert.ok(n <= 3, `${name}:${i + 1} run block has ${n} lines — move it to scripts/ci/`);
      }
    }
  });
});

describe('ci scripts (NFR-DX-004)', () => {
  const report = (tests) => ({ suites: [{ title: 'a.spec.ts', specs: [{ title: 'boots', tests }], suites: [] }] });
  const flake = (sb, r) => {
    sb.write('r.json', JSON.stringify(r));
    return sb.node('scripts/ci/flake-report.mjs', [sb.path('r.json')], { env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  };

  it('flake-report fails a test that passed only on retry, names it and asks for quarantine (NFR-DX-004)', () => {
    const sb = sandbox(['scripts/ci']);
    try {
      const ok = flake(sb, report([{ projectName: 'chromium', status: 'expected' }]));
      assert.equal(ok.status, 0, out(ok));
      assert.match(ok.stdout, /1 run, 0 flaky, 0 failed/);
      const r = flake(
        sb,
        report([
          { projectName: 'webkit', status: 'flaky' },
          { projectName: 'chromium', status: 'expected' },
        ]),
      );
      assert.equal(r.status, 1, out(r));
      assert.match(r.stdout, /^FLAKY \[webkit\] a\.spec\.ts › boots — quarantine within 24 h/m);
    } finally {
      sb.cleanup();
    }
  });

  it('flake-report fails a failed test and an empty or all-skipped report (NFR-DX-004)', () => {
    const sb = sandbox(['scripts/ci']);
    try {
      const failed = flake(sb, report([{ projectName: 'firefox', status: 'unexpected' }]));
      assert.equal(failed.status, 1, out(failed));
      assert.match(failed.stdout, /^FAILED \[firefox\]/m);
      for (const r of [{ suites: [] }, report([{ projectName: 'chromium', status: 'skipped' }])]) {
        const empty = flake(sb, r);
        assert.equal(empty.status, 1, out(empty));
        assert.match(empty.stdout, /no test ran/);
      }
    } finally {
      sb.cleanup();
    }
  });

  it('all-green passes only when every needed job succeeded; skipped, cancelled and none fail (NFR-DX-004)', () => {
    const sb = sandbox(['scripts/ci']);
    try {
      const green = (needs) => sb.node('scripts/ci/all-green.mjs', [JSON.stringify(needs)]);
      const ok = green({ verify: { result: 'success' }, build: { result: 'success' } });
      assert.equal(ok.status, 0, out(ok));
      for (const bad of ['failure', 'skipped', 'cancelled']) {
        const r = green({ verify: { result: 'success' }, e2e: { result: bad } });
        assert.equal(r.status, 1, `${bad}: ${out(r)}`);
        assert.ok(r.stdout.split(/\r?\n/).includes(`FAIL e2e (${bad})`), out(r));
      }
      assert.equal(green({}).status, 1);
    } finally {
      sb.cleanup();
    }
  });
});
