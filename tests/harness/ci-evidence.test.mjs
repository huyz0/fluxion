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
  jobs: OSES.map((os) => ({ name: `${job} (${os})`, conclusion: 'success' })),
});
/** `r` with the job for `os` concluded `conclusion`. */
const withJob = (r, os, conclusion) => ({ ...r, jobs: r.jobs.map((j) => (j.name.endsWith(`(${os})`) ? { ...j, conclusion } : j)) });

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
    for (const [key, path, subject] of [
      ['code', 'packages/a.ts', 'M9.1: feat(core): a'],
      ['end', 'packages/b.ts', 'M9.2: feat(core): b'],
      ['book', '.harness/progress.md', 'M9.3: chore(harness): progress'],
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

  it('fails a commit before M1.21, even with green runs', () => {
    const r = check(record(sha.old), green(sha.old));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after M1\.21/);
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

  it('--milestone fails a recorded sha before the final review range end, even with green runs', () => {
    const r = check(record(sha.code), green(sha.code), ['--milestone', 'M9']);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after the final review range end of M9/);
  });

  it('--milestone passes a sha at or after the final review range end', () => {
    for (const s of [sha.end, sha.book]) {
      const r = check(record(s), green(s), ['--milestone', 'M9']);
      assert.equal(r.status, 0, out(r));
    }
  });

  it('--milestone without a final review uses HEAD last non-bookkeeping commit', () => {
    // M8 has no review: the floor is sha.end (sha.book only touches .harness/)
    const early = check(record(sha.code), green(sha.code), ['--milestone', 'M8']);
    assert.equal(early.status, 1, out(early));
    assert.match(early.stderr, /is not at or after HEAD's last non-bookkeeping commit \(no M8 final review yet\) \(\w{7}\)/);
    assert.match(early.stderr, new RegExp(sha.end.slice(0, 7)));
    for (const s of [sha.end, sha.book]) assert.equal(check(record(s), green(s), ['--milestone', 'M8']).status, 0, s);
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
