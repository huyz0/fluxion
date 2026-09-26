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

  it('fails a commit before M1.21, even with green runs', () => {
    const r = check(record(sha.old), green(sha.old));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /is not at or after M1\.21/);
  });

  it('fails a red or missing OS job, a failed run, or a run of another commit', () => {
    const cases = [
      [[withJob(run(1, 'gates', sha.new, 'gates'), 'macos-latest', 'failure'), run(2, 'ci', sha.new, 'verify')], /gates: job gates \(macos-latest\) failure/],
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
});
