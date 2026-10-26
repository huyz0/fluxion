import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ghSource } from '../../scripts/gates/ci-runs.mjs';

const step = { name: 'cold setup within COLD_SETUP_MAX_MS', conclusion: 'success' };
const run = { databaseId: 12, jobs: [{ databaseId: 34, name: 'cold-setup', conclusion: 'success', steps: [step] }] };
const job = { id: 34, run_id: 12, name: 'cold-setup', steps: [{ ...step, started_at: '2026-10-26T22:29:26Z', completed_at: '2026-10-26T22:36:50Z' }] };
function reader(response = job, status = 0) {
  const calls = [];
  const source = ghSource((_command, args) => {
    calls.push(args);
    return args[0] === 'run' ? { status: 0, stdout: JSON.stringify(run) } : { status, stdout: JSON.stringify(response), stderr: status ? 'HTTP 403' : '' };
  });
  return { source, calls };
}

describe('NFR-DX-001: actual CI cold-step timestamps', () => {
  it('hydrates missing gh view timestamps from the exact job API', async () => {
    const { source, calls } = reader();
    const result = await source.view(12);
    const actual = result.jobs[0].steps[0];
    assert.equal(Date.parse(actual.completedAt) - Date.parse(actual.startedAt), 444000);
    assert.deepEqual(calls[1], ['api', 'repos/huyz0/fluxion/actions/jobs/34']);
  });
  it('keeps complete timestamps without requesting another endpoint', async () => {
    let calls = 0;
    const source = ghSource(() => {
      calls++;
      return {
        status: 0,
        stdout: JSON.stringify({
          ...run,
          jobs: [{ ...run.jobs[0], steps: [{ ...step, startedAt: '2026-10-26T22:29:26Z', completedAt: '2026-10-26T22:36:50Z' }] }],
        }),
      };
    });
    assert.equal((await source.view(12)).jobs[0].steps[0].completedAt, '2026-10-26T22:36:50Z');
    assert.equal(calls, 1);
  });
  it('rejects a job from another run instead of borrowing its duration', async () => {
    await assert.rejects(reader({ ...job, run_id: 99 }).source.view(12), /job identity/);
  });
  it('stops on denied job access without retries or alternate routes', async () => {
    const { source, calls } = reader(job, 1);
    await assert.rejects(source.view(12), /HTTP 403/);
    assert.equal(calls.length, 2);
  });
});
