// HARNESS: a change that moves the loop's state moves state.json's clock with it (M18.266, cp42 F3).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { stateClockProblems } from '../../scripts/gates/check-digest.mjs';
import { out, sandbox } from './helpers.mjs';

const ROW = (id, state = 'todo', commit = '') => `| ${id} | task | HARNESS | WHEN x THE SYSTEM SHALL y | — | ${state} | ${commit} |`;
const backlog = (rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
const state = (fields) =>
  JSON.stringify({ milestone: 'M18', currentTask: 'M18.1', attempts: 0, blockedReason: 'waiting on a card', updated: '2026-11-04T20:00:00.000Z', ...fields });
const HEAD = { headState: state({}), headBacklog: backlog([ROW('M18.1'), ROW('M18.2')]) };
const staged = (fields = {}, rows = [ROW('M18.1'), ROW('M18.2')]) => ({ ...HEAD, stagedState: state(fields), stagedBacklog: backlog(rows) });
const LATER = '2026-11-04T20:00:01.000Z';

describe('state.json clock (M18.266)', () => {
  it('refuses a currentTask change that leaves updated where HEAD had it', () => {
    const [problem] = stateClockProblems(staged({ currentTask: 'M18.2' }));
    assert.match(problem, /not later than HEAD's .* moves currentTask/);
    assert.deepEqual(stateClockProblems(staged({ currentTask: 'M18.2', updated: LATER })), []);
  });

  it('refuses a blockedReason change whose updated moves backwards', () => {
    const [problem] = stateClockProblems(staged({ blockedReason: null, updated: '2026-11-04T19:59:59.000Z' }));
    assert.match(problem, /moves blockedReason/);
    assert.deepEqual(stateClockProblems(staged({ blockedReason: null, updated: LATER })), []);
  });

  it("refuses a row's State change with state.json untouched, and names the row", () => {
    const [problem] = stateClockProblems(staged({}, [ROW('M18.1', 'done'), ROW('M18.2')]));
    assert.match(problem, /moves M18\.1's State/);
    assert.deepEqual(stateClockProblems(staged({ updated: LATER }, [ROW('M18.1', 'done'), ROW('M18.2')])), []);
  });

  it('lets through a change that moves none of them: a new todo row, a Commit cell, attempts', () => {
    assert.deepEqual(stateClockProblems(staged({ attempts: 2 }, [ROW('M18.1', 'todo', 'abc1234'), ROW('M18.2'), ROW('M18.3')])), []);
  });

  it('refuses an updated more than five minutes ahead of the change (cp43 F1)', () => {
    const now = Date.parse('2026-11-04T20:10:00.000Z');
    const [problem] = stateClockProblems({ ...staged({ currentTask: 'M18.2', updated: '2026-11-04T20:15:01.000Z' }), now });
    assert.match(problem, /is ahead of this change's time/);
    assert.deepEqual(stateClockProblems({ ...staged({ currentTask: 'M18.2', updated: '2026-11-04T20:15:00.000Z' }), now }), []);
  });

  it('refuses a change to updated alone that sets it ahead, and leaves an unchanged future clock to HEAD (cp43 F1, r2 F1)', () => {
    const now = Date.parse('2026-11-04T20:01:00.000Z');
    assert.match(stateClockProblems({ ...staged({ updated: '2027-11-04T20:00:00.000Z' }), now })[0], /is ahead of this change's time/);
    const future = { ...HEAD, headState: state({ updated: '2027-11-04T20:00:00.000Z' }) };
    assert.deepEqual(
      stateClockProblems({ ...future, stagedState: state({ updated: '2027-11-04T20:00:00.000Z', attempts: 1 }), stagedBacklog: HEAD.headBacklog, now }),
      [],
    );
  });

  it("accepts an honest time after a future-dated HEAD once it is later than HEAD's commit time (cp43 F1)", () => {
    // HEAD's updated says 22:30, but HEAD was committed at 21:35; an honest 21:40 passes, 21:30 does not
    const ahead = { ...HEAD, headState: state({ updated: '2026-11-04T22:30:00.000Z' }), headCommitTime: Date.parse('2026-11-04T21:35:00.000Z') };
    const now = Date.parse('2026-11-04T21:40:00.000Z');
    const at = (updated) => stateClockProblems({ ...ahead, stagedState: state({ currentTask: 'M18.2', updated }), stagedBacklog: HEAD.headBacklog, now });
    assert.deepEqual(at('2026-11-04T21:40:00.000Z'), []);
    assert.match(at('2026-11-04T21:30:00.000Z')[0], /not later than HEAD's/);
  });

  it('refuses an updated that is not a date, and judges nothing without a HEAD state.json', () => {
    assert.match(stateClockProblems(staged({ currentTask: 'M18.2', updated: 'soon' }))[0], /is not a date/);
    assert.deepEqual(stateClockProblems({ ...staged({ currentTask: 'M18.2' }), headState: '' }), []);
  });
});

describe('check-digest runs the clock check on the staged tree (M18.266)', () => {
  let sb;
  const run = (...args) => {
    const r = sb.git(...args);
    assert.equal(r.status, 0, out(r));
  };
  before(() => {
    sb = sandbox(['scripts'], { git: true });
    sb.write('docs/milestones/roadmap.md', '# Roadmap\n\n**Current milestone: `M18`**\n');
    sb.write('docs/backlog/current.md', backlog([ROW('M18.1'), ROW('M18.2')]));
    sb.write('.harness/reviews/digest.log', '');
    sb.write('.harness/state.json', `${state({})}\n`);
    run('add', '.');
    run('commit', '-q', '--no-verify', '-m', 'fixture baseline');
  });
  after(() => sb.cleanup());

  it('fails a staged currentTask change with the old clock, and passes once the clock moves', () => {
    sb.write('.harness/state.json', `${state({ currentTask: 'M18.2' })}\n`);
    run('add', '.harness/state.json');
    const refused = sb.node('scripts/gates/check-digest.mjs');
    assert.equal(refused.status, 1, out(refused));
    assert.match(out(refused), /not later than HEAD's .* moves currentTask/);
    sb.write('.harness/state.json', `${state({ currentTask: 'M18.2', updated: LATER })}\n`);
    run('add', '.harness/state.json');
    const passed = sb.node('scripts/gates/check-digest.mjs');
    assert.equal(passed.status, 0, out(passed));
  });
});
