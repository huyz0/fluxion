// NFR-DX-003: index tables in AGENTS.md and docs/standards/README.md are generated, never stale.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

/** Run build-index in a fresh sandbox after `mutate`; returns the result and the files after it. */
function run(mutate, args = ['--check']) {
  const sb = sandbox(['scripts', '.agents', 'AGENTS.md', 'docs/standards']);
  try {
    mutate(sb);
    const r = sb.node('scripts/harness/build-index.mjs', args);
    return { r, sb: { agents: sb.read('AGENTS.md'), standards: sb.read('docs/standards/README.md') } };
  } finally {
    sb.cleanup();
  }
}

describe('build-index (NFR-DX-003)', () => {
  it('--check passes on the real repo', () => {
    const { r } = run(() => {});
    assert.equal(r.status, 0, out(r));
  });

  it('--check fails when a skill description changes', () => {
    const { r } = run((sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('Use whenever writing or changing code.', 'Use whenever touching any code at all.')));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /stale index: AGENTS\.md \(skills\)/);
  });

  it('--check fails when a standard is added or its Read when changes', () => {
    const { r } = run((sb) => sb.write('docs/standards/new.md', '# New\n\n> Read when: doing new things.\n> Family: Code\n'));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /stale index: docs\/standards\/README\.md \(standards\)/);
  });

  it('regenerates the tables so the next --check passes', () => {
    const sb = sandbox(['scripts', '.agents', 'AGENTS.md', 'docs/standards']);
    try {
      sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('Use whenever writing or changing code.', 'Use whenever touching any code at all.'));
      assert.equal(sb.node('scripts/harness/build-index.mjs').status, 0);
      assert.match(sb.read('AGENTS.md'), /\| Whenever touching any code at all \|/);
      assert.equal(sb.node('scripts/harness/build-index.mjs', ['--check']).status, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('keeps a dotted filename inside the use-when sentence intact', () => {
    const { sb } = run(() => {}, []);
    assert.match(sb.agents, /when docs\/backlog\/current\.md has no rows/);
  });

  it('fails loudly on a standard without a Family line', () => {
    const { r } = run((sb) => sb.write('docs/standards/new.md', '# New\n\n> Read when: doing new things.\n'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing "> Family:" line/);
  });

  it('fails loudly when index markers are missing', () => {
    const { r } = run((sb) => sb.edit('AGENTS.md', (t) => t.replace('<!-- index:skills:start -->', '')));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing index:skills markers/);
  });
});
