// NFR-PORT-005 / NFR-SEC-005: the gates workflow runs the local gate definitions on three OSes
// with SHA-pinned actions, and re-checks every commit. Structural check (no YAML dependency).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const wf = readFileSync(join(REPO, '.github/workflows/gates.yml'), 'utf8');

describe('gates workflow (NFR-PORT-005)', () => {
  it('runs on ubuntu, windows and macos', () => {
    // since M2.22 the ladder's three-OS run is ci.yml's verify matrix; gates.yml adds the ubuntu-only gates
    assert.match(/^ {2}verify:[\s\S]*?(?=^ {2}\S)/m.exec(ci)?.[0] ?? '', /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    assert.match(wf, /^ {4}runs-on: ubuntu-latest$/m);
  });

  it('pins every action to a full commit SHA (NFR-SEC-005)', () => {
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 2);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `unpinned action ${u}`);
  });

  it('runs the same gate scripts as the local hooks', () => {
    // `pnpm verify` is the ladder itself (precommit.mjs --all), run by ci.yml since M2.22
    assert.equal(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts.verify, 'node scripts/gates/precommit.mjs --all');
    // ADR-0214: Windows runs the same ladder split in two jobs (--skip / --only harness-tests); the other OSes run `pnpm verify`
    assert.match(ci, /'node scripts\/gates\/precommit\.mjs --all --skip harness-tests' \|\| 'pnpm verify' \}\}\n/);
    assert.doesNotMatch(ci, /node --test "tests\/harness\/\*\.test\.mjs"/, 'full ladder runs the harness once');
    assert.match(wf, /node scripts\/gates\/check-workflows\.mjs --require-docker/);
    assert.match(wf, /node scripts\/gates\/check-commits\.mjs --range/);
    // M18.119: review evidence is judged remotely too, on full history and on a PR's own head
    assert.match(wf, /^ {8}run: node scripts\/gates\/check-digest\.mjs --head --full-history$/m);
    assert.match(wf, /fetch-depth: 0/);
    assert.match(wf, /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  });

  it('commit messages checked by script: the per-commit step is one check-commits.mjs call and only ci.yml verifies on three OSes (M1 final F5)', () => {
    const step = /- name: per-commit message gates\n[\s\S]*?(?=\n {6}- |(?![\s\S]))/.exec(wf)?.[0] ?? '';
    assert.ok(step, 'gates.yml has a per-commit message gates step');
    const runs = [...step.matchAll(/^ {8}run: (.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(runs, ['node scripts/gates/check-commits.mjs --range "$BASE..$HEAD_SHA"'], 'one single-line call, no inline shell');
    assert.doesNotMatch(step, /shell:|0000000000|e4273a6/, 'the base fallback lives in check-commits.mjs');
    // a commit closing a blocking row has its CI evidence read live, with a read-only actions token (M18.135)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression, not a JS template
    assert.ok(step.includes('GH_TOKEN: ${{ github.token }}'), 'check-commits can read CI runs');
    assert.match(wf, /^permissions:\n {2}contents: read\n(?: {2}#.*\n)* {2}actions: read$/m);
    // the full ladder runs once per OS: exactly one workflow has a three-OS matrix running it
    const threeOs = WORKFLOWS.filter((name) => {
      const text = workflow(name);
      return /precommit\.mjs --all|pnpm verify\b/.test(text) && /windows-latest/.test(text) && /macos-latest/.test(text);
    });
    assert.deepEqual(threeOs, ['ci.yml']);
    const code = wf
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(code, /windows-latest|macos-latest|matrix|pnpm install|precommit\.mjs|pnpm verify/, 'gates.yml is ubuntu-only and runs no ladder');
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
    const sb = sandbox(['scripts', 'docs/backlog', 'docs/milestones/roadmap.md'], { git: true });
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

  it('an empty or all-zero base (first push of a branch) falls back to the baseline (M1 final F5)', () => {
    const sb = sandbox(['scripts', 'docs/backlog', 'docs/milestones/roadmap.md'], { git: true });
    try {
      const baseline = sb.git('rev-parse', 'HEAD').stdout.trim();
      for (const n of [1, 2]) {
        sb.write(`f${n}.txt`, `${n}\n`);
        sb.git('add', '-A');
        sb.git('commit', '-q', '--no-verify', '-m', `M0.12: chore: step ${n}`);
      }
      const head = sb.git('rev-parse', 'HEAD').stdout.trim();
      for (const base of ['', '0'.repeat(40)]) {
        const r = sb.node('scripts/gates/check-commits.mjs', ['--range', `${base}..${head}`, '--baseline', baseline]);
        assert.equal(r.status, 0, out(r));
        assert.match(r.stdout, new RegExp(`checking from the baseline ${baseline}`));
        assert.match(r.stdout, new RegExp(`2/2 commits pass \\(${baseline}\\.\\.${head}\\)`));
      }
      // a real base is used as given
      const given = sb.node('scripts/gates/check-commits.mjs', ['--range', `${head}~1..${head}`, '--baseline', baseline]);
      assert.match(given.stdout, /1\/1 commits pass/, out(given));
      assert.doesNotMatch(given.stdout, /baseline/);
      // the default baseline is the pre-harness commit, absent here: a bad range, not a silent pass
      const dflt = sb.node('scripts/gates/check-commits.mjs', ['--range', `..${head}`]);
      assert.equal(dflt.status, 2, out(dflt));
      assert.match(dflt.stderr, /bad range e4273a6\.\./);
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

/**
 * M18.277: the install form each kind of job must use; a Linux-only job keeps the system deps. M18.279: so does every job that runs
 * the browser suites (`suites`), on Windows too: without Media Foundation the Windows verify ladder hung to its limit (ci 42038170007).
 */
const INSTALL_FORMS = {
  windows: /^install chromium$/,
  matrix: /^install \$\{\{ runner\.os != 'Windows' && '--with-deps ' \|\| '' \}\}chromium$/,
  other: /^install --with-deps (\$\{\{ matrix\.browser \}\}|\S+)$/,
  suites: /^install --with-deps chromium$/,
};
/** The jobs whose Windows legs run the Vitest browser project or the Playwright visual suite (M18.279). */
const BROWSER_SUITE_JOBS = new Set(['verify', 'visual-xos']);

/** Every `playwright install` in a workflow, with the kind of job it runs in: a browser-suite job, always Windows, a matrix with Windows, or neither. */
function browserInstalls(text) {
  return text.split(/\n(?= {2}[\w-]+:\n)/).flatMap((job) => {
    const name = /^ {2}([\w-]+):\n/.exec(job)?.[1] ?? '';
    const runsOn = /^ {4}runs-on: (.*)$/m.exec(job)?.[1];
    const matrixWindows = /- (?:os: )?windows-latest\b|os: \[[^\]]*windows-latest/.test(job);
    const plain = matrixWindows ? 'matrix' : 'other';
    const kind = BROWSER_SUITE_JOBS.has(name) ? 'suites' : runsOn === 'windows-latest' ? 'windows' : plain;
    return [...job.matchAll(/run: pnpm exec playwright (install .*)/g)].map(([, cmd]) => ({ kind, cmd }));
  });
}

describe('ci workflow (NFR-PORT-005, NFR-SEC-005)', () => {
  it('has the planned job set and ci-ok needs every other job (NFR-PORT-005)', () => {
    const jobs = jobsOf(ci);
    for (const j of ['verify', 'cold-setup', 'build', 'e2e', 'e2e-report', 'visual', 'size', 'api', 'license', 'eval-recorded', 'ci-ok'])
      assert.ok(jobs.includes(j), j);
    const needs = /^ {2}ci-ok:[\s\S]*?needs:\s*\[([^\]]*)\]/m
      .exec(ci)[1]
      .split(',')
      .map((s) => s.trim());
    assert.deepEqual(needs.toSorted(), jobs.filter((j) => j !== 'ci-ok').toSorted());
    assert.match(/^ {2}ci-ok:[\s\S]*?(?=^ {2}\S|(?![\s\S]))/m.exec(ci)[0], /if: always\(\)/, 'ci-ok must run when a dependency failed');
  });

  it('NFR-DX-001: no ci job may fail without failing the run; cold-setup exempts only time, in check-budget (M18.159)', () => {
    // M18.117 made cold-setup continue-on-error; M18.159 replaced that with a time-only exemption in check-budget --cold
    assert.doesNotMatch(ci, /continue-on-error/, 'no job- or step-level exemption');
    const jobs = /^jobs:\n([\s\S]*)$/m.exec(ci)[1].split(/^(?= {2}[\w-]+:$)/m);
    assert.match(
      jobs.find((j) => j.startsWith('  cold-setup:')),
      /- name: cold setup within COLD_SETUP_MAX_MS\n\s+run: node scripts\/gates\/check-budget\.mjs --cold\n/,
    );
  });

  it('NFR-DX-001 NFR-MNT-004: only the cold setup runs the ladder without coverage; the verify jobs keep it (ADR-0216, M18.157)', () => {
    // the ladder refuses --no-coverage outside --all: a staged or quick run never drops it
    for (const mode of [[], ['--quick']]) {
      const r = spawnSync(process.execPath, ['scripts/gates/precommit.mjs', ...mode, '--no-coverage'], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 2, out(r));
      assert.match(r.stderr, /--no-coverage is for the cold setup's --all ladder only \(ADR-0216\)/);
    }
    // the test step itself: plain --all runs the coverage run, --all --no-coverage runs Vitest without it (a stub pnpm records the calls)
    const stub = sandbox([]);
    try {
      stub.write(
        'bin/stub.mjs',
        "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_PNPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n",
      );
      stub.write('bin/pnpm', '#!/bin/sh\nexec node "$(dirname "$0")/stub.mjs" "$@"\n');
      stub.write('bin/pnpm.cmd', '@node "%~dp0stub.mjs" %*\r\n');
      chmodSync(stub.path('bin/pnpm'), 0o755);
      const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      const calls = (...flags) => {
        stub.write('pnpm.log', '');
        const env = { ...process.env, [key]: `${stub.path('bin')}${delimiter}${process.env[key] ?? ''}`, STUB_PNPM_LOG: stub.path('pnpm.log') };
        const r = spawnSync(process.execPath, ['scripts/gates/precommit.mjs', '--all', '--only', 'test', '--no-review', '--no-budget', ...flags], {
          cwd: REPO,
          encoding: 'utf8',
          env,
        });
        assert.equal(r.status, 0, out(r));
        return {
          r,
          vitest: stub
            .read('pnpm.log')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
            .filter((a) => a.includes('vitest') || a.includes('test:coverage')),
        };
      };
      assert.deepEqual(calls().vitest, [['run', 'test:coverage']]);
      const bare = calls('--no-coverage');
      assert.deepEqual(bare.vitest, [['exec', 'vitest', 'run']]);
      assert.match(bare.r.stdout, /test: without coverage \(--no-coverage: the cold setup\); the verify jobs gate the coverage floors \(ADR-0216\)/);
    } finally {
      stub.cleanup();
    }
    // check-budget's cold setup is its one caller: no workflow, hook, script or package script passes it
    const files = spawnSync('git', ['ls-files', 'scripts', '.github', '.githooks', 'package.json'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n');
    // (tracked scripts and workflows only: no package path is read)
    const passing = files.filter((f) => f && readFileSync(join(REPO, ...f.split('/')), 'utf8').includes('--no-coverage'));
    assert.deepEqual(passing.toSorted(), ['scripts/gates/check-budget.mjs', 'scripts/gates/precommit.mjs']);
    assert.match(readFileSync(join(REPO, 'scripts/gates/check-budget.mjs'), 'utf8'), /pnpm\('verify', \['verify', '--no-coverage'\]\)/);
    // the verify jobs run `pnpm verify`, whose test step is the whole coverage run with the floors (verify needs no flag to keep it)
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.verify, 'node scripts/gates/precommit.mjs --all');
    assert.equal(pkg.scripts['test:coverage'], 'vitest run --coverage');
    assert.match(/^ {2}ci-ok:[\s\S]*?(?=^ {2}\S|(?![\s\S]))/m.exec(ci)[0], /needs: \[verify,/);
  });

  it('verifies on three OSes and shards e2e over three engines x 4 in the pinned image (NFR-PORT-005)', () => {
    assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    assert.match(ci, /browser: \[chromium, firefox, webkit\]\n\s+shard: \[1, 2, 3, 4\]/);
    const images = [...ci.matchAll(/image:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(images.length >= 3, 'e2e, visual and lighthouse run in the Playwright image');
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

  it('NFR-A11Y-001 (ADR-0207, M18.184): the chromium e2e shards run every spec the a11y job ran, so axe runs once per commit', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts;
    // test:a11y = the chromium project minus @no-a11y; test:e2e on chromium = the chromium project minus @perf, which that project already drops
    assert.equal(pkg['test:a11y'], 'playwright test --project=chromium --grep-invert @no-a11y');
    assert.equal(pkg['test:e2e'], 'playwright test --grep-invert @perf');
    const config = readFileSync(join(REPO, 'playwright.config.ts'), 'utf8');
    assert.match(config, /\{ name: 'chromium', use: \{[^\n]*\}, grepInvert: \/@mobile\|@perf\/ \}/);
    const e2e = /^ {2}e2e:[\s\S]*?(?=^ {2}\S)/m.exec(ci)[0];
    assert.match(e2e, /browser: \[chromium, firefox, webkit\]/);
    assert.match(e2e, /- run: pnpm test:e2e --project="\$BROWSER" --project="\$MOBILE" --shard="\$SHARD\/\d" --reporter=blob --pass-with-no-tests\n/);
    assert.ok(!jobsOf(ci).includes('a11y'), 'axe runs once, in the e2e shards');
    // the axe fixture is part of every spec's test object, so the shards make the same assertions the a11y job made
    assert.match(readFileSync(join(REPO, 'e2e/test.ts'), 'utf8'), /expectAccessible: async \(\{ page \}, use\) =>/);
    const specs = readdirSync(join(REPO, 'e2e')).filter((f) => f.endsWith('.spec.ts'));
    const axe = specs.filter((f) => readFileSync(join(REPO, 'e2e', f), 'utf8').includes('expectAccessible'));
    assert.ok(axe.length >= 10, axe.join());
  });

  it('HARNESS (M18.182): every bare-runner browser install restores the locked release from a cache keyed on it; cold-setup downloads everything', () => {
    const BROWSERS_JSON = 'node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json';
    // the key's glob names exactly the installed Playwright release (pnpm's store layout)
    const store = readdirSync(join(REPO, 'node_modules/.pnpm')).filter((d) => /^playwright-core@[^_]+$/.test(d));
    assert.equal(store.length, 1, store.join());
    assert.ok(readFileSync(join(REPO, 'node_modules/.pnpm', store[0], 'node_modules/playwright-core/browsers.json'), 'utf8').includes('"browsers"'));
    let installs = 0;
    for (const name of ['ci.yml', 'nightly.yml']) {
      const steps = workflow(name).split(/\n(?= {6}- )/);
      steps.forEach((step, i) => {
        const install =
          /run: pnpm exec playwright install (?:--with-deps |\$\{\{ runner\.os != 'Windows' && '--with-deps ' \|\| '' \}\})?(\$\{\{ matrix\.browser \}\}|\S+)/.exec(
            step,
          );
        if (!install) return;
        installs++;
        const cache = steps[i - 1];
        assert.match(
          cache,
          /- name: playwright browsers cache\n {8}(?:if: .*\n {8})?uses: actions\/cache@[0-9a-f]{40} # v/,
          `${name}: no cache before ${install[0]}`,
        );
        assert.equal(/if: (.*)/.exec(cache)?.[1], /if: (.*)/.exec(step)?.[1], `${name}: the cache runs exactly when its install runs`);
        assert.ok(
          cache.includes(`key: playwright-${install[1]}-\${{ runner.os }}-\${{ runner.arch }}-\${{ hashFiles('${BROWSERS_JSON}') }}`),
          `${name}: ${cache}`,
        );
        assert.match(
          cache,
          /path: \$\{\{ runner\.os == 'Windows' && '~\/AppData\/Local\/ms-playwright' \|\| runner\.os == 'macOS' && '~\/Library\/Caches\/ms-playwright' \|\| '~\/\.cache\/ms-playwright' \}\}/,
        );
      });
    }
    // ci: verify, harness-windows (ADR-0214) and cli-mcp; nightly: both mutation chains, properties, perf, visual-xos and previous-playwright
    assert.equal(installs, 9);
    const cold = /^ {2}cold-setup:[\s\S]*?(?=^ {2}\S)/m.exec(ci)[0];
    assert.doesNotMatch(cold, /actions\/cache|^ +cache: |playwright install/m, 'the cold setup measures an empty store and browser cache (NFR-DX-001)');
  });

  it('HARNESS (M18.277, M18.279): Windows installs outside the browser-suite jobs skip --with-deps; the suites and Linux and macOS keep it', () => {
    // install_media_pack.ps1 is all `--with-deps chromium` does on win32 (~190 s per job); Chromium only delay-loads mf.dll, but the
    // Windows verify ladder hung to its limit without it (M18.279), so verify and visual-xos keep it
    const seen = { windows: 0, matrix: 0, other: 0, suites: 0 };
    for (const name of ['ci.yml', 'nightly.yml']) {
      for (const { kind, cmd } of browserInstalls(workflow(name))) {
        seen[kind]++;
        assert.match(cmd, INSTALL_FORMS[kind], `${name}: a ${kind} job's install: ${cmd}`);
      }
    }
    // windows: harness-windows; matrix: cli-mcp; suites: ci verify, nightly visual-xos
    assert.deepEqual([seen.windows, seen.matrix, seen.suites], [1, 1, 2]);
    assert.ok(seen.other >= 5, String(seen.other));
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
    // the spec reporter over every harness file outside staged mode (--all: verify, CI); staged mode scopes (M4.26)
    const pre = readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(pre, /'--test-reporter=spec', '--test', \.\.\.harnessToRun\(\)/);
    assert.match(pre, /mode === 'staged' \? harnessFiles\(stagedPaths\(\), HARNESS\(\), scopeOptions\(\)\) : HARNESS\(\)/);
    const verify = /^ {2}verify:[\s\S]*?(?=^ {2}\S)/m.exec(ci)?.[0] ?? '';
    // ADR-0197: Windows verification is widened to 25 of 45 minutes, ADR-0209: macOS to 20 of 40; ubuntu keeps 15 of 35 (ADR-0191)
    assert.match(verify, /^ {4}timeout-minutes: \$\{\{ matrix\.os == 'windows-latest' && 45 \|\| matrix\.os == 'macos-latest' && 40 \|\| 35 \}\}$/m);
    assert.match(
      verify,
      /- run: \$\{\{ matrix\.os == 'windows-latest' && 'node scripts\/gates\/precommit\.mjs --all --skip harness-tests' \|\| 'pnpm verify' \}\}\n\s+timeout-minutes: \$\{\{ matrix\.os == 'windows-latest' && 25 \|\| matrix\.os == 'macos-latest' && 20 \|\| 15 \}\}\n/,
    );
    // ADR-0214 (M18.256): the leg verify (windows-latest) skips runs in harness-windows, within the same step and job bounds, and ci-ok needs it
    const harness = /^ {2}harness-windows:[\s\S]*?(?=^ {2}\S)/m.exec(ci)?.[0] ?? '';
    assert.match(harness, /name: harness tests \(windows-latest\)\n\s+runs-on: windows-latest\n\s+timeout-minutes: 45\n/);
    assert.match(harness, /- run: node scripts\/gates\/precommit\.mjs --all --only harness-tests\n\s+timeout-minutes: 25\n/);
    assert.match(harness, /playwright install chromium/);
    assert.doesNotMatch(harness, /continue-on-error|retry/);
    assert.match(ci, /needs: \[verify, harness-windows, /);
    assert.match(verify, /chromium for the Vitest browser project \(T1\)\n\s+timeout-minutes: 15/);
    assert.doesNotMatch(verify, /name: harness tests|continue-on-error|retry/);
    assert.match(verify, /name: verification failure reports\n\s+if: always\(\) && \(failure\(\) \|\| cancelled\(\)\)\n\s+timeout-minutes: 2/);
    assert.match(pre, /withLiveStepLog\(repoPath\(/);
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
    // M18.187: a scanner that is off takes no runner; the zizmor job, which always runs, prints why each one skipped
    const job = (name) => new RegExp(`^ {2}${name}:\\n[\\s\\S]*?(?=^ {2}\\S|(?![\\s\\S]))`, 'm').exec(sec)[0];
    assert.match(job('codeql'), /^ {4}if: vars\.CODE_SCANNING == 'true'$/m);
    assert.match(job('dependency-review'), /^ {4}if: github\.event_name == 'pull_request' && vars\.CODE_SCANNING == 'true'$/m);
    for (const name of ['codeql', 'dependency-review']) assert.doesNotMatch(job(name), /SKIP|^ {6}- if:/m, name);
    const zizmor = job('zizmor');
    assert.doesNotMatch(zizmor, /^ {4}if:/m, 'zizmor always runs');
    assert.match(zizmor, /- if: vars\.CODE_SCANNING != 'true'\n\s+run: echo "codeql — SKIP, code scanning not enabled/);
    assert.match(zizmor, /- if: github\.event_name != 'pull_request'\n\s+run: echo "dependency-review — SKIP, only a pull request has a dependency diff"/);
    assert.match(
      zizmor,
      /- if: github\.event_name == 'pull_request' && vars\.CODE_SCANNING != 'true'\n\s+run: echo "dependency-review — SKIP, dependency review not enabled/,
    );
    assert.match(ci, /^ {2}security:\n[\s\S]*?uses: \.\/\.github\/workflows\/security\.yml/m);
  });

  it('nightly.yml has the planned jobs and reports failures as one issue (NFR-SEC-005)', () => {
    const nightly = workflow('nightly.yml');
    assert.deepEqual(jobsOf(nightly), [
      'mutation-plan',
      'mutation-partitions',
      'mutation-partitions-2',
      'mutation',
      'properties',
      'perf',
      'eval-live',
      'visual-xos',
      'previous-playwright',
      'report',
    ]);
    assert.match(nightly, /FC_RUNS: '10000'/);
    // ADR-0198: the partitions run as two chained matrices (GitHub caps one at 256 jobs), 4 concurrent each, 8 in all
    const first = /^ {2}mutation-partitions:[\s\S]*?(?=^ {2}mutation-partitions-2:)/m.exec(nightly)?.[0] ?? '';
    const second = /^ {2}mutation-partitions-2:[\s\S]*?(?=^ {2}mutation:)/m.exec(nightly)?.[0] ?? '';
    assert.match(first, /matrix: \$\{\{ fromJSON\(needs\.mutation-plan\.outputs\.matrix\) \}\}/);
    assert.match(second, /matrix: \$\{\{ fromJSON\(needs\.mutation-plan\.outputs\.matrix_2\) \}\}/);
    assert.match(second, /if: \$\{\{ fromJSON\(needs\.mutation-plan\.outputs\.chains\) > 1 \}\}/);
    assert.match(nightly, /matrix_2: \$\{\{ steps\.plan\.outputs\.matrix_2 \}\}/);
    assert.match(nightly, /chains: \$\{\{ steps\.plan\.outputs\.chains \}\}/);
    // 8 concurrent in all: the first matrix alone runs 8, two chains run 4 each
    assert.match(first, /max-parallel: \$\{\{ fromJSON\(needs\.mutation-plan\.outputs\.chains\) > 1 && 4 \|\| 8 \}\}\n/);
    assert.match(second, /max-parallel: 4\n/);
    for (const partitions of [first, second]) {
      assert.match(partitions, /fail-fast: false/);
      assert.match(partitions, /timeout-minutes: 60/);
      assert.match(partitions, /Execute complete mutation partition/);
      assert.match(partitions, /node scripts\/harness\/mutate-shard\.mjs --manifest reports\/mutation-plan\.json --partition/);
      assert.match(partitions, /mutation-partition-\$\{\{ matrix.id \}\}/);
      assert.doesNotMatch(partitions, /continue-on-error|--from|--dedup|--retries [1-9]/);
    }
    const aggregate = /^ {2}mutation:[\s\S]*?(?=^ {2}properties:)/m.exec(nightly)?.[0] ?? '';
    assert.match(aggregate, /needs: \[mutation-plan, mutation-partitions, mutation-partitions-2\]/);
    assert.match(aggregate, /if: always\(\)/);
    assert.match(aggregate, /Validate complete mutation reports/);
    assert.match(aggregate, /node scripts\/ci\/mutation-nightly\.mjs aggregate/);
    assert.match(aggregate, /merge-multiple: false/);

    const report = /^ {2}report:[\s\S]*/m.exec(nightly)[0];
    assert.match(report, /needs: \[mutation, properties, perf, eval-live, visual-xos, previous-playwright\]/);
    // NFR-PORT-001 (M11.23): the previous-major job points the catalog at the older Playwright, runs all five projects (three engines and their mobile presets), and commits nothing
    const previous = /^ {2}previous-playwright:[\s\S]*?(?=^ {2}report:)/m.exec(nightly)[0];
    assert.match(previous, /node scripts\/ci\/previous-playwright\.mjs/);
    assert.match(previous, /pnpm install --no-frozen-lockfile/);
    for (const project of ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari']) assert.match(previous, new RegExp(`\\b${project}\\b`), project);
    assert.doesNotMatch(previous, /git (commit|push)/);
    // the visual baselines belong to the pinned image, and the cross-OS visual job builds before it renders (M11.58)
    assert.match(previous, /--grep-invert "@perf\|@visual"/);
    assert.match(/^ {2}visual-xos:[\s\S]*?(?=^ {2}\S)/m.exec(nightly)[0], /pnpm run build[\s\S]*playwright test --grep "@visual"/);
    assert.match(report, /if: failure\(\)/);
    assert.equal([...nightly.matchAll(/issues: write/g)].length, 1, 'only the report job writes issues');
    assert.match(report, /issues: write/);
  });

  it('NFR-PORT-006 (ADR-0202): visual-xos gates its ubuntu leg in the pinned image and only the legs without baselines are known red', () => {
    const nightly = workflow('nightly.yml');
    const xos = /^ {2}visual-xos:[\s\S]*?(?=^ {2}\S)/m.exec(nightly)[0];
    const legs = [...xos.matchAll(/- os: (\S+)\n\s+image: (\S+)\n\s+known-red: (true|false)/g)].map(([, os, image, red]) => ({ os, image, red }));
    // the ubuntu leg uses the very image ci.yml's visual job made the baselines in
    const pinned = /^ {2}visual:[\s\S]*?image: (\S+)/m.exec(workflow('ci.yml'))[1];
    assert.deepEqual(legs, [
      { os: 'ubuntu-latest', image: pinned, red: 'false' },
      { os: 'windows-latest', image: "''", red: 'true' },
      { os: 'macos-latest', image: "''", red: 'true' },
    ]);
    assert.match(xos, /^ {4}container: \$\{\{ matrix\.image \}\}$/m);
    // the matrix flag is the only thing that lets a leg fail: no step and no other job forgives a failure
    assert.match(xos, /^ {4}continue-on-error: \$\{\{ matrix\.known-red \}\}$/m);
    assert.equal([...nightly.matchAll(/continue-on-error/g)].length, 2, 'the visual-xos flag and the bounded clipboard probe');
    assert.match(xos, /if: \$\{\{ matrix\.image == '' \}\}\n\s+run: pnpm exec playwright install --with-deps chromium/);
    assert.match(nightly, /^ {2}# ADR-0202:[^\n]*\n(?: {2}#[^\n]*\n)* {2}visual-xos:/m);
  });

  it('HARNESS: nightly perf exposes failure annotations and preserves the JSON report without retries', () => {
    const perf = /^ {2}perf:[\s\S]*?(?=^ {2}\S)/m.exec(workflow('nightly.yml'))[0];
    assert.match(
      perf,
      /^ {6}- run: pnpm exec playwright test --project=perf --workers=1 --retries=0 --reporter=list,json,github\n {8}env:\n {10}PLAYWRIGHT_JSON_OUTPUT_NAME: test-results\/e2e\.json$/m,
    );
  });

  it('HARNESS: every nightly Playwright path keeps failure artifacts and explicit JSON output', () => {
    const nightly = workflow('nightly.yml');
    for (const name of ['perf', 'visual-xos', 'previous-playwright']) {
      const job = new RegExp(`^ {2}${name}:[\\s\\S]*?(?=^ {2}\\S)`, 'm').exec(nightly)[0];
      assert.match(job, /PLAYWRIGHT_JSON_OUTPUT_NAME: test-results\/e2e\.json/, name);
      assert.match(job, /playwright test[^\n]*--retries=0[^\n]*--reporter=list,json,github/, name);
      assert.match(
        job,
        /if: \$\{\{ failure\(\) \}\}[\s\S]*?uses: actions\/upload-artifact@[0-9a-f]{40}[\s\S]*?path: test-results\n[\s\S]*?retention-days: 14/,
        name,
      );
    }
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
    const sb = sandbox(['scripts/ci', 'scripts/gates/failure-report.mjs', 'scripts/gates/lib.mjs']);
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
    const sb = sandbox(['scripts/ci', 'scripts/gates/failure-report.mjs', 'scripts/gates/lib.mjs']);
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
