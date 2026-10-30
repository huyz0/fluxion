// NFR-PORT-005 / NFR-SEC-005: the recorded CI evidence names green gates and ci runs on ubuntu,
// windows and macos for a commit at or after M1.21, re-read from GitHub (here: a runs fixture).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const OSES = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
const run = (id, workflowName, headSha, job) => ({
  databaseId: id,
  workflowName,
  headSha,
  conclusion: 'success',
  // ci also runs the visual job (M5.3) and the Lighthouse job (M11.19)
  jobs: [
    ...OSES.map((os) => ({ name: `${job} (${os})`, conclusion: 'success' })),
    ...(workflowName === 'ci'
      ? [
          { name: 'visual', conclusion: 'success' },
          { name: 'lighthouse', conclusion: 'success' },
        ]
      : []),
  ],
});
/** `r` with the job for `os` concluded `conclusion`. */
const withJob = (r, os, conclusion) => ({ ...r, jobs: r.jobs.map((j) => (j.name.endsWith(`(${os})`) ? { ...j, conclusion } : j)) });

/** A nightly workflow whose perf job runs `step`. */
const workflow = (step) => ['jobs:', '  perf:', '    steps:', `      - run: ${step}`, ''].join('\n');

let sb;
const sha = {};
const check = (record, runs, extra = []) => {
  sb.write('ev.json', JSON.stringify(record));
  sb.write('runs.json', JSON.stringify(runs));
  return sb.node('scripts/gates/check-ci-evidence.mjs', ['--file', sb.path('ev.json'), '--runs-file', sb.path('runs.json'), ...extra]);
};

describe('check-ci-evidence (NFR-PORT-005, NFR-SEC-005)', () => {
  before(() => {
    sb = sandbox(['scripts'], { git: true });
    for (const [key, subject] of [
      ['old', 'M1.20: ci(ci): before the security workflows'],
      ['m121', 'M1.21: ci(security): workflows'],
      ['new', 'M1.40: fix(ci): later'],
    ]) {
      sb.git('commit', '-q', '--allow-empty', '--no-verify', '-m', subject);
      sha[key] = sb.git('rev-parse', 'HEAD').stdout.trim();
    }
    // M9: two code commits, then a bookkeeping-only one (the paths final-review range checks allow)
    // the nightly whose perf step does not retry (M16 final F12), from M9.1 on
    sb.write('.github/workflows/nightly.yml', workflow('pnpm exec playwright test --project=perf --workers=1 --retries=0'));
    sb.git('add', '.github/workflows/nightly.yml');
    for (const [key, path, subject] of [
      ['code', 'packages/a.ts', 'M9.1: feat(core): a'],
      ['end', 'packages/b.ts', 'M9.2: feat(core): b'],
      ['book', '.harness/progress.md', 'M9.3: chore(harness): progress'],
      // an exit checklist tick after the range end does not move the floor (M16 final F17)
      ['tick', 'docs/milestones/exits/R9.md', 'M9.4: docs(milestones): tick the perf row'],
    ]) {
      sb.write(path, `${key}\n`);
      sb.git('add', path);
      sb.git('commit', '-q', '--no-verify', '-m', subject);
      sha[key] = sb.git('rev-parse', 'HEAD').stdout.trim();
    }
    sb.write(
      '.harness/reviews/milestone-M9-final.json',
      JSON.stringify({ milestone: 'M9', checkpoint: 'final', range: `${sha.m121.slice(0, 7)}..${sha.end.slice(0, 7)}` }),
    );
  });
  after(() => sb.cleanup());

  const green = (s) => [run(1, 'gates', s, 'gates'), run(2, 'ci', s, 'verify')];
  const record = (s) => ({ sha: s, recordedAt: '2026-09-27T00:00:00Z', runs: { gates: 1, ci: 2 } });

  it('passes green gates and ci runs on all three OSes for a commit after M1.21', () => {
    const r = check(record(sha.new), green(sha.new));
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /green on ubuntu-latest, windows-latest, macos-latest/);
    assert.equal(check(record(sha.m121), green(sha.m121)).status, 0, 'M1.21 itself counts');
  });

  it('accepts the ubuntu-only gates job and still needs verify green on every OS (M2.22)', () => {
    const gates = { ...run(1, 'gates', sha.new, 'gates'), jobs: [{ name: 'gates', conclusion: 'success' }] };
    const r = check(record(sha.new), [gates, run(2, 'ci', sha.new, 'verify')]);
    assert.equal(r.status, 0, out(r));
    const noWindows = check(record(sha.new), [gates, withJob(run(2, 'ci', sha.new, 'verify'), 'windows-latest', 'cancelled')]);
    assert.equal(noWindows.status, 1, out(noWindows));
    assert.match(noWindows.stderr, /ci: job verify \(windows-latest\) cancelled/);
  });

  // M2 final F5: a transport failure no longer hides the stale-evidence floor error
  it('stale sha reported with a transport failure', () => {
    const [gates, ci] = green(sha.old);
    const r = check(record(sha.old), [{ databaseId: gates.databaseId, error: 'fetch failed' }, ci]);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after M1\.21/);
    assert.match(r.stderr, /reading gates run 1 failed: fetch failed/);
  });

  it('a transport failure names HTTPS_PROXY when Node fetch would ignore it', async () => {
    const { transportHint } = await import('../../scripts/gates/ci-runs.mjs');
    assert.match(transportHint({ env: { HTTPS_PROXY: 'http://proxy:3128' }, gh: false }), /HTTPS_PROXY is set, but Node fetch ignores it/);
    assert.equal(transportHint({ env: { HTTPS_PROXY: 'http://proxy:3128' }, gh: true }), '', 'gh honours the proxy itself');
    assert.equal(transportHint({ env: { HTTPS_PROXY: 'http://proxy:3128', NODE_USE_ENV_PROXY: '1' }, gh: false }), '');
    assert.equal(transportHint({ env: {}, gh: false }), '');
  });

  it('fails a commit before M1.21, even with green runs', () => {
    const r = check(record(sha.old), green(sha.old));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after M1\.21/);
  });

  it('evidence without a green visual job fails (M5.3)', () => {
    const ci = run(2, 'ci', sha.new, 'verify');
    for (const jobs of [ci.jobs.map((j) => (j.name === 'visual' ? { ...j, conclusion: 'failure' } : j)), ci.jobs.filter((j) => j.name !== 'visual')]) {
      const r = check(record(sha.new), [run(1, 'gates', sha.new, 'gates'), { ...ci, jobs }]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /ci: job visual (failure|missing)/);
    }
  });

  it('evidence without a green Lighthouse job fails (M11.19)', () => {
    const ci = run(2, 'ci', sha.new, 'verify');
    for (const jobs of [ci.jobs.map((j) => (j.name === 'lighthouse' ? { ...j, conclusion: 'failure' } : j)), ci.jobs.filter((j) => j.name !== 'lighthouse')]) {
      const r = check(record(sha.new), [run(1, 'gates', sha.new, 'gates'), { ...ci, jobs }]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /ci: job lighthouse (failure|missing)/);
    }
  });

  it('fails a red or missing OS job, a failed run, or a run of another commit', () => {
    const cases = [
      // gates is ubuntu-only since M2.22; ci's verify is the three-OS job
      [[withJob(run(1, 'gates', sha.new, 'gates'), 'ubuntu-latest', 'failure'), run(2, 'ci', sha.new, 'verify')], /gates: job gates \(ubuntu-latest\) failure/],
      [[run(1, 'gates', sha.new, 'gates'), withJob(run(2, 'ci', sha.new, 'verify'), 'macos-latest', 'failure')], /ci: job verify \(macos-latest\) failure/],
      [[{ ...run(1, 'gates', sha.new, 'gates'), jobs: [] }, run(2, 'ci', sha.new, 'verify')], /gates: job gates missing/],
      [[run(1, 'gates', sha.new, 'gates'), { ...run(2, 'ci', sha.new, 'verify'), jobs: [] }], /ci: job verify \(ubuntu-latest\) missing/],
      [[run(1, 'gates', sha.new, 'gates'), { ...run(2, 'ci', sha.new, 'verify'), conclusion: 'failure' }], /ci run 2 concluded failure/],
      [[run(1, 'gates', sha.m121, 'gates'), run(2, 'ci', sha.new, 'verify')], /run 1 ran \w{7}, not/],
      [[run(1, 'ci', sha.new, 'verify'), run(2, 'ci', sha.new, 'verify')], /run 1 is workflow ci, not gates/],
    ];
    for (const [runs, why] of cases) {
      const r = check(record(sha.new), runs);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, why);
    }
  });

  it('fails without a record, and --record keeps only successful runs of the commit', () => {
    const missing = sb.node('scripts/gates/check-ci-evidence.mjs', ['--file', sb.path('none.json')]);
    assert.equal(missing.status, 1, out(missing));
    assert.match(missing.stderr, /is missing: after a green push run check-ci-evidence\.mjs --record/);
    const listed = [
      { databaseId: 7, workflowName: 'ci', conclusion: 'failure' },
      { databaseId: 1, workflowName: 'gates', conclusion: 'success' },
      { databaseId: 2, workflowName: 'ci', conclusion: 'success' },
    ];
    sb.write('runs.json', JSON.stringify(listed));
    const none = sb.node('scripts/gates/check-ci-evidence.mjs', ['--record', sha.new, '--file', sb.path('rec.json'), '--runs-file', sb.path('runs.json')]);
    // the listing fixture has no jobs, so the follow-up check fails; the record itself is what matters
    assert.match(none.stdout, /recorded \w{7} \{"gates":1,"ci":2\}/, out(none));
    assert.equal(JSON.parse(sb.read('rec.json')).sha, sha.new);
  });

  it('HARNESS: --record refuses while a job that failed on the same product tree is not yet green in two later runs (M18.196, cp25 F2)', () => {
    const s = sandbox(['scripts'], { git: true });
    try {
      const commit = (path, subject) => {
        s.write(path, `${subject}\n`);
        s.git('add', path);
        s.git('commit', '-q', '--no-verify', '-m', subject);
        return s.git('rev-parse', 'HEAD').stdout.trim();
      };
      const before = commit('packages/old.ts', 'M9.1: feat(core): an older product tree');
      const product = commit('packages/p.ts', 'M9.2: fix(cli): the product tree under test');
      // harness, ci and docs commits keep the product tree (like e3f6e36, db19f11, ceb8246 on 8cae07a)
      const h1 = commit('scripts/gates/x.mjs', 'M9.3: fix(harness): one');
      const h2 = commit('docs/architecture/decisions/ADR-9.md', 'M9.4: docs(adr): two');
      const h3 = commit('.github/workflows/x.yml', 'M9.5: ci(ci): three');
      const at = (id, head, minute, windows = 'success') => ({
        ...withJob(run(id, 'ci', head, 'verify'), 'windows-latest', windows),
        conclusion: windows,
        status: 'completed',
        createdAt: `2026-10-29T10:${minute}:00Z`,
      });
      const gates = { ...run(1, 'gates', h2, 'gates'), status: 'completed', createdAt: '2026-10-29T10:20:00Z' };
      const rec = (runs) => {
        s.write('runs.json', JSON.stringify(runs));
        return s.node('scripts/gates/check-ci-evidence.mjs', [
          '--record',
          h2,
          '--since',
          product,
          '--file',
          s.path('rec.json'),
          '--runs-file',
          s.path('runs.json'),
        ]);
      };
      // windows verify failed at h1 (twice, as in 40894960957 and 40905801401), then one green at h2: refused
      const flaky = [at(20, h2, '20'), gates, at(10, h1, '10', 'failure'), at(11, h1, '12', 'failure')];
      let r = rec(flaky);
      assert.equal(r.status, 1, out(r));
      assert.match(
        r.stderr,
        /not recording \w{7}: .*job verify \(windows-latest\) failure in ci run 11 at \w{7} on the same product tree, green in 1 later run\(s\) of 2 needed/,
      );
      // a second later green on the tree records
      r = rec([...flaky, at(30, h3, '30')]);
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /recorded \w{7} \{"gates":1,"ci":20\}/);
      // a failure on an earlier product tree does not count
      r = rec([at(20, h2, '20'), gates, at(5, before, '05', 'failure')]);
      assert.equal(r.status, 0, out(r));
      // the check holds the record too: without the second green, the recorded evidence is refused
      s.write('runs.json', JSON.stringify(flaky));
      r = s.node('scripts/gates/check-ci-evidence.mjs', ['--file', s.path('rec.json'), '--runs-file', s.path('runs.json'), '--since', product]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /job verify \(windows-latest\) failure in ci run 10/);
    } finally {
      s.cleanup();
    }
  });

  it("HARNESS: --record pages main's ci runs back to the tree's start and refuses when it cannot (M18.199, cp26 F1)", () => {
    const s = sandbox(['scripts'], { git: true });
    try {
      const commit = (path, subject) => {
        s.write(path, `${subject}\n`);
        s.git('add', path);
        s.git('commit', '-q', '--no-verify', '-m', subject);
        return s.git('rev-parse', 'HEAD').stdout.trim();
      };
      const before = commit('packages/old.ts', 'M9.1: feat(core): an older product tree');
      const product = commit('packages/p.ts', 'M9.2: fix(cli): the product tree under test');
      // ten harness pushes on the tree, as after 40894960957 and 40905801401
      const heads = Array.from({ length: 10 }, (_, i) => commit(`scripts/gates/h${i}.mjs`, `M9.${3 + i}: fix(harness): push ${i}`));
      const at = (id, head, minute, windows = 'success') => ({
        ...withJob(run(id, 'ci', head, 'verify'), 'windows-latest', windows),
        conclusion: windows,
        status: 'completed',
        createdAt: `2026-10-29T10:${String(minute).padStart(2, '0')}:00Z`,
      });
      const tip = heads.at(-1);
      const gates = { ...run(1, 'gates', tip, 'gates'), status: 'completed', createdAt: '2026-10-29T11:00:00Z' };
      // one green at the tip, nine cancelled pushes, the two windows failures on page 3 of five-run pages
      const later = [at(60, tip, 50), ...heads.slice(0, 9).map((h, i) => at(50 + i, h, 40 + i, 'cancelled'))];
      const failed = [at(41, product, 20, 'failure'), at(40, product, 10, 'failure')];
      const start = at(30, before, 5);
      const rec = (runs) => {
        s.write('runs.json', JSON.stringify(runs));
        return s.node('scripts/gates/check-ci-evidence.mjs', [
          '--record',
          tip,
          '--since',
          product,
          '--file',
          s.path('rec.json'),
          '--runs-file',
          s.path('runs.json'),
          '--page-size',
          '5',
        ]);
      };
      let r = rec([...later, ...failed, start, gates]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /not recording \w{7}: .*job verify \(windows-latest\) failure in ci run 41 .*green in 1 later run\(s\) of 2 needed/);
      // the same tree read in full with a second later green records
      const second = at(61, tip, 55);
      r = rec([second, ...later, ...failed, start, gates]);
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /recorded \w{7} \{"gates":1,"ci":61\}/);
      // a history cut before the tree's start, or an unreadable page, refuses: unread runs are no green
      r = rec([second, ...later, ...failed, gates, { truncated: true }]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /not recording \w{7}: reading main's ci runs on the product tree of \w{7} failed: main's ci runs ran out at page 4/);
      r = rec([second, ...later, ...failed, start, gates, { pageFails: 2 }]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /page 2 of the runs file failed/);
    } finally {
      s.cleanup();
    }
  });

  it('--milestone fails a recorded sha before the final review range end, even with green runs', () => {
    const r = check(record(sha.code), green(sha.code), ['--milestone', 'M9']);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after the final review range end of M9/);
  });

  it('--since needs the recorded sha at or after the given commit (M18.135)', () => {
    const before = check(record(sha.m121), green(sha.m121), ['--since', sha.new]);
    assert.equal(before.status, 1, out(before));
    assert.match(before.stderr, /is not at or after [0-9a-f]{7}/);
    for (const s of [sha.new, sha.end]) assert.equal(check(record(s), green(s), ['--since', sha.new]).status, 0, s);
    const unknown = check(record(sha.new), green(sha.new), ['--since', '0'.repeat(40)]);
    assert.equal(unknown.status, 1, out(unknown));
    assert.match(unknown.stderr, /no such commit/);
  });

  it('--milestone passes a sha at or after the final review range end', () => {
    for (const s of [sha.end, sha.book]) {
      const r = check(record(s), green(s), ['--milestone', 'M9']);
      assert.equal(r.status, 0, out(r));
    }
  });

  it('--perf needs a recorded nightly run whose perf job passed at or after the floor, with no retry (M16 final F3, F12)', () => {
    const nightly = (id, s, conclusion) => ({
      databaseId: id,
      workflowName: 'nightly',
      headSha: s,
      conclusion: 'failure',
      jobs: [{ name: 'perf', conclusion }],
    });
    const withPerf = (s, p) => ({ ...record(s), perf: { run: 9, sha: p } });
    // the nightly run may fail elsewhere (mutation, visual): only its perf job counts
    const ok = check(withPerf(sha.end, sha.book), [...green(sha.end), nightly(9, sha.book, 'success')], ['--milestone', 'M9', '--perf']);
    assert.equal(ok.status, 0, out(ok));
    const none = check(record(sha.end), green(sha.end), ['--milestone', 'M9', '--perf']);
    assert.match(none.stderr, /no nightly perf run recorded/, out(none));
    const red = check(withPerf(sha.end, sha.end), [...green(sha.end), nightly(9, sha.end, 'failure')], ['--milestone', 'M9', '--perf']);
    assert.match(red.stderr, /nightly: job perf failure/, out(red));
    const stale = check(withPerf(sha.end, sha.code), [...green(sha.end), nightly(9, sha.code, 'success')], ['--milestone', 'M9', '--perf']);
    assert.match(stale.stderr, /the perf run's \w{7} is not at or after the final review range end of M9/, out(stale));
    // a perf step that retries could pass a spec on its second attempt and read as a success (M16 final F12)
    // a run whose commit still retried: on a side branch after the floor, HEAD unchanged
    sb.git('checkout', '-q', '-b', 'retrying');
    sb.write('.github/workflows/nightly.yml', workflow('pnpm exec playwright test --project=perf --workers=1'));
    sb.git('commit', '-q', '--no-verify', '-am', 'M9.5: ci(nightly): perf retries');
    sha.retrying = sb.git('rev-parse', 'HEAD').stdout.trim();
    sb.git('checkout', '-q', '-');
    const retrying = check(withPerf(sha.end, sha.retrying), [...green(sha.end), nightly(9, sha.retrying, 'success')], ['--milestone', 'M9', '--perf']);
    assert.match(retrying.stderr, /runs the perf project without --retries=0/, out(retrying));
    // without --perf the record's runs alone decide, as before
    assert.equal(check(record(sha.end), green(sha.end), ['--milestone', 'M9']).status, 0);
  });

  it('--milestone without a final review uses HEAD last non-bookkeeping commit', () => {
    // M8 has no review: the floor is sha.end (sha.book only touches .harness/)
    const early = check(record(sha.code), green(sha.code), ['--milestone', 'M8']);
    assert.equal(early.status, 1, out(early));
    assert.match(early.stderr, /is not at or after HEAD's last non-bookkeeping commit \(no M8 final review yet\) \(\w{7}\)/);
    assert.match(early.stderr, new RegExp(sha.end.slice(0, 7)));
    for (const s of [sha.end, sha.book, sha.tick]) assert.equal(check(record(s), green(s), ['--milestone', 'M8']).status, 0, s);
  });
});

describe('ci-runs: GitHub REST reader when gh is absent (NFR-PORT-005)', () => {
  const ghRun = { id: 11, name: 'gates', head_sha: 'a'.repeat(40), conclusion: 'success', status: 'completed', event: 'push' };
  const ghJobs = OSES.map((os, i) => ({ id: 100 + i, name: `gates (${os})`, conclusion: 'success', steps: [] }));
  // endpoint suffix -> REST body; anything else answers 404
  const routes = [
    [/\/actions\/runs\/11$/, ghRun],
    [/\/actions\/runs\/11\/jobs\?/, { total_count: 3, jobs: ghJobs }],
    [/\/actions\/runs\?head_sha=/, { workflow_runs: [ghRun, { ...ghRun, id: 12, name: 'ci', conclusion: 'failure' }] }],
  ];
  /** Fake fetch answering those endpoints; records each request. No network. */
  const fakeFetch = (calls) => async (url, init) => {
    calls.push({ url, headers: init.headers });
    const body = routes.find(([re]) => re.test(url))?.[1];
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
  };

  it('maps REST runs and jobs to the gh run view shape the evidence check reads', async () => {
    const { restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const calls = [];
    const rest = restSource({ fetch: fakeFetch(calls) });
    const withSteps = run(11, 'gates', 'a'.repeat(40), 'gates');
    assert.deepEqual(await rest.view(11), { ...withSteps, jobs: withSteps.jobs.map((j) => ({ ...j, steps: [] })) });
    assert.deepEqual(await rest.list('a'.repeat(40)), [
      { databaseId: 11, workflowName: 'gates', conclusion: 'success' },
      { databaseId: 12, workflowName: 'ci', conclusion: 'failure' },
    ]);
    assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/repos/huyz0/fluxion/actions/runs')));
    assert.ok(
      calls.every((c) => !('Authorization' in c.headers)),
      'no token, no Authorization header',
    );
    await assert.rejects(rest.view(99), /answered 404/);
  });

  it("HARNESS: ci's push runs are paged alike through REST and gh, and a tree's runs are read to its start (M18.199, cp26 F1)", async () => {
    const { ghSource, restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const { pagedTreeRuns } = await import('../../scripts/gates/same-tree.mjs');
    const ghRunOf = (id) => ({ id, name: 'ci', head_sha: 'c'.repeat(40), status: 'completed', conclusion: 'success', created_at: 'T' });
    const mapped = { databaseId: 7, workflowName: 'ci', headSha: 'c'.repeat(40), status: 'completed', conclusion: 'success', createdAt: 'T' };
    const urls = [];
    const fetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ workflow_runs: [ghRunOf(7)] }) };
    };
    assert.deepEqual(await restSource({ fetch }).ciPage('main', 2), [mapped]);
    const path = 'actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100&page=2';
    assert.equal(urls[0], `https://api.github.com/repos/huyz0/fluxion/${path}`);
    const spawned = [];
    const gh = ghSource((cmd, args) => {
      spawned.push([cmd, ...args]);
      return { status: 0, stdout: JSON.stringify({ workflow_runs: [ghRunOf(7)] }) };
    });
    assert.deepEqual(await gh.ciPage('main', 2), [mapped]);
    assert.deepEqual(spawned[0], ['gh', 'api', `repos/huyz0/fluxion/${path}`]);
    // paging stops at the tree's start; running out first, or past maxPages, throws
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]];
    const read = [];
    const page = async (n) => {
      read.push(n);
      return pages[n - 1] ?? [];
    };
    const on = (r) => r.id <= 3;
    assert.deepEqual(await pagedTreeRuns({ page, on, start: (r) => r.id === 4 }), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.deepEqual(read, [1, 2]);
    await assert.rejects(pagedTreeRuns({ page, on, start: () => false }), /ran out at page 4/);
    await assert.rejects(pagedTreeRuns({ page, on, start: () => false, maxPages: 2 }), /in 2 pages/);
    assert.equal((await pagedTreeRuns({ page, on, start: () => false, complete: true })).length, 3);
    await assert.rejects(
      pagedTreeRuns({
        page: async () => {
          throw new Error('answered 502');
        },
        on,
        start: () => false,
      }),
      /answered 502/,
    );
  });

  it("NFR-MNT-005: the nightly's runs are read by workflow file on the branch, whatever their event (M18.124)", async () => {
    const { ghSource, restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const nightly = { id: 21, name: 'nightly', head_sha: 'b'.repeat(40), conclusion: 'failure', status: 'completed', event: 'schedule', created_at: 'T' };
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ workflow_runs: [nightly] }) };
    };
    assert.deepEqual(await restSource({ fetch }).nightly('main'), [
      { databaseId: 21, workflowName: 'nightly', headSha: 'b'.repeat(40), status: 'completed', conclusion: 'failure', createdAt: 'T' },
    ]);
    assert.equal(calls[0].url, 'https://api.github.com/repos/huyz0/fluxion/actions/workflows/nightly.yml/runs?branch=main&per_page=5');
    const spawned = [];
    await ghSource((cmd, args) => {
      spawned.push([cmd, ...args]);
      return { status: 0, stdout: '[]' };
    }).nightly('main');
    assert.deepEqual(spawned[0].slice(0, 8), ['gh', 'run', 'list', '--workflow', 'nightly.yml', '--branch', 'main', '--limit']);
  });

  it("NFR-DX-001: a run's cold-setup job and its log are read through REST and gh, the log null when unreadable (M18.161)", async () => {
    const { ghSource, restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const jobs = [
      { id: 7, name: 'verify (ubuntu-latest)', conclusion: 'success' },
      {
        id: 8,
        name: 'cold-setup',
        conclusion: 'failure',
        steps: [{ name: 'cold setup within COLD_SETUP_MAX_MS', started_at: '2026-10-28T10:00:00Z', completed_at: '2026-10-28T10:11:04Z' }],
      },
    ];
    const calls = [];
    const fetch = (logOk) => async (url) => {
      calls.push(url);
      if (url.endsWith('/logs')) return { ok: logOk, status: logOk ? 200 : 403, text: async () => 'budget: cold setup failed by time' };
      return { ok: true, status: 200, json: async () => ({ jobs }) };
    };
    assert.deepEqual(await restSource({ fetch: fetch(true) }).coldSetup(41), { conclusion: 'failure', ms: 664_000, log: 'budget: cold setup failed by time' });
    assert.deepEqual(calls, [
      'https://api.github.com/repos/huyz0/fluxion/actions/runs/41/jobs?per_page=100',
      'https://api.github.com/repos/huyz0/fluxion/actions/jobs/8/logs',
    ]);
    assert.deepEqual(await restSource({ fetch: fetch(false) }).coldSetup(41), { conclusion: 'failure', ms: 664_000, log: null });
    const spawned = [];
    const gh = (logStatus) =>
      ghSource((cmd, args) => {
        spawned.push([cmd, ...args]);
        if (args[0] === 'api') return { status: logStatus, stdout: 'budget: cold setup failed by status' };
        return { status: 0, stdout: JSON.stringify({ jobs: [{ databaseId: 9, name: 'cold-setup', conclusion: 'failure' }] }) };
      });
    assert.deepEqual(await gh(0).coldSetup(42), { conclusion: 'failure', ms: null, log: 'budget: cold setup failed by status' });
    assert.deepEqual(spawned.slice(0, 2), [
      ['gh', 'run', 'view', '42', '--json', 'jobs'],
      ['gh', 'api', 'repos/huyz0/fluxion/actions/jobs/9/logs'],
    ]);
    assert.deepEqual(await gh(1).coldSetup(42), { conclusion: 'failure', ms: null, log: null });
    // the cold step's duration comes from gh's step times too (M18.164)
    const timed = ghSource((_cmd, args) => {
      if (args[0] === 'api') return { status: 1, stdout: '' };
      const steps = [{ name: 'cold setup within COLD_SETUP_MAX_MS', startedAt: '2026-10-28T10:00:00Z', completedAt: '2026-10-28T10:09:25Z' }];
      return { status: 0, stdout: JSON.stringify({ jobs: [{ databaseId: 9, name: 'cold-setup', conclusion: 'success', steps }] }) };
    });
    assert.deepEqual(await timed.coldSetup(42), { conclusion: 'success', ms: 565_000, log: null });
    // an older gh without step times: the successful cold job's times are fetched, as view() does (M18.178)
    const hydrated = ghSource((_cmd, args) => {
      if (args[0] === 'api' && args[1].endsWith('/logs')) return { status: 1, stdout: '' };
      if (args[0] === 'api') {
        const steps = [{ name: 'cold setup within COLD_SETUP_MAX_MS', started_at: '2026-10-28T10:00:00Z', completed_at: '2026-10-28T10:11:04Z' }];
        return { status: 0, stdout: JSON.stringify({ id: 9, run_id: 42, name: 'cold-setup', steps }) };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          jobs: [{ databaseId: 9, name: 'cold-setup', conclusion: 'success', steps: [{ name: 'cold setup within COLD_SETUP_MAX_MS' }] }],
        }),
      };
    });
    assert.deepEqual(await hydrated.coldSetup(42), { conclusion: 'success', ms: 664_000, log: null });
    // a failed hydration leaves the duration unknown but keeps the log (M18.178 r1)
    const failing = ghSource((_cmd, args) => {
      if (args[0] === 'api' && args[1].endsWith('/logs')) return { status: 0, stdout: 'budget: cold setup 598000 ms <= 600000 ms' };
      if (args[0] === 'api') return { status: 1, stdout: '', stderr: 'HTTP 502' };
      return {
        status: 0,
        stdout: JSON.stringify({
          jobs: [{ databaseId: 9, name: 'cold-setup', conclusion: 'success', steps: [{ name: 'cold setup within COLD_SETUP_MAX_MS' }] }],
        }),
      };
    });
    assert.deepEqual(await failing.coldSetup(42), { conclusion: 'success', ms: null, log: 'budget: cold setup 598000 ms <= 600000 ms' });
  });

  it("HARNESS: a pending run's jobs and their conclusions are read through REST and gh (M18.191, cp24 F1)", async () => {
    const { ghSource, restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const jobs = [
      { id: 7, name: 'verify (windows-latest)', conclusion: 'failure', steps: [] },
      { id: 8, name: 'verify (ubuntu-latest)', conclusion: null },
    ];
    const want = [
      { name: 'verify (windows-latest)', conclusion: 'failure' },
      { name: 'verify (ubuntu-latest)', conclusion: null },
    ];
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ jobs }) };
    };
    assert.deepEqual(await restSource({ fetch }).jobs(41), want);
    assert.deepEqual(calls, ['https://api.github.com/repos/huyz0/fluxion/actions/runs/41/jobs?per_page=100']);
    const spawned = [];
    const gh = ghSource((cmd, args) => {
      spawned.push([cmd, ...args]);
      return { status: 0, stdout: JSON.stringify({ jobs: jobs.map(({ id, ...j }) => ({ databaseId: id, ...j })) }) };
    });
    assert.deepEqual(await gh.jobs(42), want);
    assert.deepEqual(spawned, [['gh', 'run', 'view', '42', '--json', 'jobs']]);
  });

  it("HARNESS: a workflow's newest completed push run is read by status, outside any mixed window (M18.134, cp14 F1)", async () => {
    const { ghSource, restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const red = { id: 31, name: 'ci', head_sha: 'c'.repeat(40), conclusion: 'failure', status: 'completed', event: 'push', created_at: 'T' };
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ workflow_runs: [red] }) };
    };
    assert.deepEqual(await restSource({ fetch }).completed('main', 'ci.yml'), [
      { databaseId: 31, workflowName: 'ci', headSha: 'c'.repeat(40), status: 'completed', conclusion: 'failure', createdAt: 'T' },
    ]);
    assert.equal(calls[0], 'https://api.github.com/repos/huyz0/fluxion/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1');
    const spawned = [];
    await ghSource((cmd, args) => {
      spawned.push([cmd, ...args]);
      return { status: 0, stdout: '[]' };
    }).completed('main', 'gates.yml');
    assert.deepEqual(spawned[0].slice(0, 13), [
      'gh',
      'run',
      'list',
      '--workflow',
      'gates.yml',
      '--branch',
      'main',
      '--event',
      'push',
      '--status',
      'completed',
      '--limit',
      '1',
    ]);
  });

  it('REST is used when gh is absent, with the Bearer token only when GITHUB_TOKEN is set', async () => {
    const { hasGh, runSource } = await import('../../scripts/gates/ci-runs.mjs');
    assert.equal(
      hasGh(() => ({ error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) })),
      false,
    );
    assert.equal(
      hasGh(() => ({ status: 0, stdout: 'gh version 2' })),
      true,
    );
    const calls = [];
    await runSource({ gh: false, env: { GITHUB_TOKEN: 'fake-token' }, fetch: fakeFetch(calls) }).view(11);
    assert.equal(calls[0].headers.Authorization, 'Bearer fake-token');
    const spawned = [];
    const viaGh = runSource({
      gh: true,
      fetch: () => assert.fail('fetch must not be called when gh is installed'),
      spawn: (cmd, args) => {
        spawned.push([cmd, ...args]);
        return { status: 0, stdout: JSON.stringify(run(11, 'gates', 'a'.repeat(40), 'gates')) };
      },
    });
    assert.equal((await viaGh.view(11)).databaseId, 11);
    assert.deepEqual(spawned[0].slice(0, 4), ['gh', 'run', 'view', '11']);
  });
});
