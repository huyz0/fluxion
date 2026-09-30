// NFR-DX-003: the deterministic Stop hook blocks only while the loop is active and the gate is red.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

let sb;
const GATE = 'scripts/gates/m0-complete.mjs';
const setState = (over) => sb.write('.harness/state.json', JSON.stringify({ milestone: 'M0', loopActive: true, blockedReason: null, ...over }));
const fakeGate = (green) =>
  sb.write(
    GATE,
    `console.log('FAIL demo leg');console.log('GATE m0: ${green ? '3/3' : '2/3'} legs green${green ? '' : ' — next red leg: demo leg'}');process.exit(${green ? 0 : 1});\n`,
  );
const hook = (env = {}) => sb.node('scripts/harness/stop-check.mjs', [], { input: '{"stop_hook_active":false}', env: { ...process.env, ...env } });

describe('stop-check (NFR-DX-003)', () => {
  beforeEach(() => {
    sb = sandbox();
    sb.write('docs/backlog/current.md', '| ID | Task |\n|---|---|\n| M0.1 | done thing | x | x | — | done | |\n| M0.2 | next thing | x | x | — | todo | |\n');
  });
  afterEach(() => sb.cleanup());

  it('allows stopping silently when the loop is inactive', () => {
    setState({ loopActive: false });
    fakeGate(false);
    const r = hook();
    assert.equal(r.status, 0, out(r));
    assert.equal(r.stdout, '');
  });

  it('blocks with the first red leg and next todo row while active and red', () => {
    setState({});
    fakeGate(false);
    const r = hook();
    assert.equal(r.status, 0, out(r));
    const d = JSON.parse(r.stdout);
    assert.equal(d.decision, 'block');
    assert.match(d.reason, /next red leg: demo leg/);
    assert.match(d.reason, /next backlog row M0\.2/);
  });

  it('allows stopping and deactivates the loop when the gate is green', () => {
    setState({});
    fakeGate(true);
    const r = hook();
    assert.equal(r.stdout, '', out(r));
    assert.equal(JSON.parse(sb.read('.harness/state.json')).loopActive, false);
  });

  it('resets the runaway counter when the gate goes green', () => {
    const cap = { FLUXION_STOP_BLOCK_CAP: '2' };
    setState({});
    fakeGate(false);
    hook(cap);
    hook(cap);
    fakeGate(true);
    hook(cap);
    setState({});
    fakeGate(false);
    assert.equal(JSON.parse(hook(cap).stdout).decision, 'block');
  });

  it('allows stopping when a blocker is recorded', () => {
    setState({ blockedReason: 'needs a decision on X' });
    fakeGate(false);
    const r = hook();
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /needs a decision on X/);
  });

  it('allows stopping after the runaway block cap', () => {
    setState({});
    fakeGate(false);
    assert.equal(JSON.parse(hook({ FLUXION_STOP_BLOCK_CAP: '2' }).stdout).decision, 'block');
    assert.equal(JSON.parse(hook({ FLUXION_STOP_BLOCK_CAP: '2' }).stdout).decision, 'block');
    const r = hook({ FLUXION_STOP_BLOCK_CAP: '2' });
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /block cap 2 reached/);
  });

  it('blocks when the milestone has no completion gate yet, but still honours the cap', () => {
    setState({ milestone: 'M99' });
    const cap = { FLUXION_STOP_BLOCK_CAP: '1' };
    assert.match(JSON.parse(hook(cap).stdout).reason, /m99-complete\.mjs does not exist/);
    const r = hook(cap);
    assert.equal(r.stdout, '', out(r));
    assert.match(r.stderr, /block cap 1 reached/);
  });

  it('names the failure when the gate crashes before printing a summary', () => {
    setState({});
    sb.write(GATE, "throw new Error('boom in gate');\n");
    const d = JSON.parse(hook().stdout);
    assert.equal(d.decision, 'block');
    assert.match(d.reason, /failed without a summary \(exit 1\)/);
    assert.doesNotMatch(d.reason, /^\. /);
  });
});
