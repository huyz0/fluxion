import assert from 'node:assert/strict';
import { it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

it('NFR-DX-002: actual M0 latency legs surface advisories but preserve failed checks and full timing', () => {
  const cases = [
    { quick: true, ms: 180001, status: 0, expected: 0 },
    { quick: true, ms: 1, status: 1, expected: 1 },
    { quick: true, ms: 180001, status: 1, expected: 1 },
    { quick: false, ms: 900001, status: 0, expected: 1 },
  ];
  for (const c of cases) {
    const sb = sandbox(['scripts']);
    try {
      sb.write(
        'scripts/gates/lib.mjs',
        `
import assert from 'node:assert/strict';
export const currentMilestone = () => 'M18';
export const exists = () => false;
export const readText = () => '';
export const repoPath = (...parts) => parts.join('/');
export const run = () => { throw Error('unexpected command'); };
export const node = (file, args) => {
  assert.equal(file, 'scripts/gates/precommit.mjs');
  assert.deepEqual(args, [${JSON.stringify(c.quick ? '--quick' : '--all')}, '--summary']);
  return { status: ${c.status}, stdout: 'ADVISORY retained subprocess warning', stderr: 'deliberate failure' };
};
let found = false;
export const leg = (name, check) => {
  if (name.startsWith(${JSON.stringify(c.quick ? 'quick gate' : 'precommit --all')})) { found = true; process.exitCode = check() === true ? 0 : 1; }
};
export const runLegs = async () => { assert.ok(found, 'actual milestone leg executed'); };
`,
      );
      sb.write(
        'scripts/gates/milestone-checks.mjs',
        ['backlogTextFor', 'checkBacklogDone', 'checkFinalReview', 'checkHooksExecutable', 'checkReviewerSmoke', 'loadMilestoneReviews']
          .map((name) => `export const ${name} = () => { throw Error('unselected leg'); };`)
          .join('\n'),
      );
      sb.write('clock.mjs', `let calls = 0; Date.now = () => calls++ === 0 ? 0 : ${c.ms}; await import('./scripts/gates/m0-complete.mjs');`);
      const r = sb.node('clock.mjs');
      assert.equal(r.status, c.expected, out(r));
      if (c.quick) assert.match(r.stdout, /ADVISORY retained subprocess warning/);
      if (c.quick && c.ms > 180000) assert.match(r.stdout, /overrun 1ms/);
    } finally {
      sb.cleanup();
    }
  }
});
