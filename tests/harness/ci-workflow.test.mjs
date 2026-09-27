// NFR-PORT-005 / NFR-SEC-005: the gates workflow runs the local gate definitions on three OSes
// with SHA-pinned actions, and re-checks every commit. Structural check (no YAML dependency).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
const WORKFLOWS = readdirSync(join(REPO, '.github/workflows')).filter((f) => f.endsWith('.yml'));
const workflow = (name) => readFileSync(join(REPO, '.github/workflows', name), 'utf8');
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
    for (const j of ['verify', 'cold-setup', 'build', 'e2e', 'e2e-report', 'visual', 'a11y', 'size', 'api', 'license', 'eval-recorded', 'ci-ok'])
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
    assert.ok(WORKFLOWS.length >= 5, WORKFLOWS.join());
    for (const name of WORKFLOWS) {
      // ./ is a reusable workflow of this repo at the same commit
      for (const [, u] of workflow(name).matchAll(/uses:\s*(\S+)/g))
        if (!u.startsWith('./')) assert.match(u, /@[0-9a-f]{40}$/, `${name}: unpinned action ${u}`);
    }
    assert.match(ci, /^permissions:\n {2}contents: read$/m);
    assert.doesNotMatch(ci, /id-token:/);
  });

  it('has no long inline scripts: a run block is at most 3 lines (NFR-PORT-005)', () => {
    for (const name of WORKFLOWS) {
      const lines = workflow(name).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const n = runBlockLength(lines, i);
        assert.ok(n <= 3, `${name}:${i + 1} run block has ${n} lines — move it to scripts/ci/`);
      }
    }
  });
});

describe('security, nightly and release workflows and Renovate (NFR-SEC-005)', () => {
  it('only release.yml can mint an OIDC token or write contents (NFR-SEC-005)', () => {
    for (const name of WORKFLOWS.filter((n) => n !== 'release.yml')) {
      assert.doesNotMatch(workflow(name), /id-token:\s*write/, name);
      assert.doesNotMatch(workflow(name), /contents:\s*write/, name);
    }
    const release = workflow('release.yml');
    assert.match(release, /^permissions: \{\}$/m, 'no workflow-level grant');
    assert.match(release, /id-token: write/);
    assert.match(release, /environment: npm/);
    assert.doesNotMatch(release, /cache:/, 'no dependency cache in the release job');
    assert.doesNotMatch(release, /secrets\.NPM_TOKEN|NODE_AUTH_TOKEN/, 'trusted publishing, no token');
  });

  it('release publishes nothing until a human sets RELEASE_ENABLED (M1.39, NFR-SEC-005)', () => {
    // without changesets, changesets/action publishes every unpublished version: the first push tried
    // all 0.0.0 packages, so the job itself is opt-in
    assert.match(workflow('release.yml'), /^ {2}release:\n {4}if: vars\.RELEASE_ENABLED == 'true'\n/m);
  });

  it('CI names failing harness tests and ships every built workspace to later jobs (M1.39, NFR-PORT-005)', () => {
    assert.match(readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8'), /'--test-reporter=spec', '--test', 'tests\/harness\/\*\.test\.mjs'/);
    // after a ladder failure only: a green ladder already ran the suite (M1.42: windows timeout)
    assert.match(wf, /- name: harness tests\n\s+if: failure\(\)\n/);
    const dist = /name: dist\n\s+path: \|\n((?:\s+\S+\/\*\/dist\n)+)/.exec(ci)?.[1] ?? '';
    const workspaces = /^packages:\n((?:\s+- \S+\n)+)/m.exec(readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'))[1];
    for (const [, glob] of workspaces.matchAll(/- (\S+)/g)) assert.ok(dist.includes(`${glob}/dist`), `build artifact misses ${glob}/dist`);
  });

  it('security.yml runs CodeQL, OSV-Scanner, dependency review and zizmor, and feeds ci-ok (NFR-SEC-005)', () => {
    const sec = workflow('security.yml');
    assert.deepEqual(jobsOf(sec), ['codeql', 'osv-scanner', 'dependency-review', 'zizmor']);
    assert.match(sec, /github\/codeql-action\/analyze@/);
    assert.match(sec, /osv-scanner-action@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+scan-args: --lockfile=pnpm-lock\.yaml/);
    assert.match(sec, /actions\/dependency-review-action@/);
    assert.match(sec, /check-workflows\.mjs --require-docker/);
    assert.match(sec, /^ {2}workflow_call:/m);
    // a disabled scanner says so instead of passing silently
    assert.equal([...sec.matchAll(/SKIP, [a-z ]+not enabled \(repo variable CODE_SCANNING\)/g)].length, 2);
    assert.match(ci, /^ {2}security:\n[\s\S]*?uses: \.\/\.github\/workflows\/security\.yml/m);
  });

  it('nightly.yml has the planned jobs and reports failures as one issue (NFR-SEC-005)', () => {
    const nightly = workflow('nightly.yml');
    assert.deepEqual(jobsOf(nightly), ['mutation', 'properties', 'perf', 'eval-live', 'visual-xos', 'report']);
    assert.match(nightly, /FC_RUNS: '10000'/);
    const report = /^ {2}report:[\s\S]*/m.exec(nightly)[0];
    assert.match(report, /needs: \[mutation, properties, perf, eval-live, visual-xos\]/);
    assert.match(report, /if: failure\(\)/);
    assert.equal([...nightly.matchAll(/issues: write/g)].length, 1, 'only the report job writes issues');
    assert.match(report, /issues: write/);
  });

  it('renovate waits a day like pnpm, pins digests and opens nothing without approval (NFR-SEC-005)', () => {
    const r = JSON.parse(readFileSync(join(REPO, 'renovate.json'), 'utf8'));
    const pnpmAge = Number(/^minimumReleaseAge:\s*(\d+)/m.exec(readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'))[1]);
    assert.equal(r.minimumReleaseAge, `${pnpmAge / 1440} day`);
    assert.ok(r.extends.includes('helpers:pinGitHubActionDigestsToSemver') && r.extends.includes('docker:pinDigests'));
    assert.equal(r.dependencyDashboardApproval, true, 'every commit needs a task id: updates are adopted in task commits');
    assert.ok(r.packageRules.some((p) => p.matchDepTypes?.includes('pnpm.catalog.default') && p.groupName));
    const cw = readFileSync(join(REPO, 'scripts/gates/check-workflows.mjs'), 'utf8');
    assert.equal([...cw.matchAll(new RegExp(r.customManagers[0].matchStrings[0], 'g'))].length, 2, 'the regex manager sees both linter images');
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

  it('nightly-issue opens one issue, or comments on the open one, naming the failed jobs (NFR-DX-004)', () => {
    const sb = sandbox(['scripts/ci']);
    try {
      const NEEDS = JSON.stringify({ perf: { result: 'success' }, properties: { result: 'failure' } });
      const run = (existing) => sb.node('scripts/ci/nightly-issue.mjs', ['--dry-run'], { env: { ...process.env, NEEDS, NIGHTLY_EXISTING: existing } });
      const fresh = run('');
      assert.equal(fresh.status, 0, out(fresh));
      assert.match(fresh.stdout, /^gh issue create --title "Nightly failure" --body "[^"]*Failed jobs: properties \(failure\)/m);
      const again = run('42');
      assert.match(again.stdout, /^gh issue comment 42 --body /m);
      assert.doesNotMatch(again.stdout, /issue create/);
    } finally {
      sb.cleanup();
    }
  });
});
