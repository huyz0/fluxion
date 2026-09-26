// NFR-DX-003: the harness stays usable from both Claude Code and Codex.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

/** Run check-portability in a fresh sandbox after applying `mutate`. */
function portability(mutate = () => {}) {
  const sb = sandbox();
  try {
    mutate(sb);
    return sb.node('scripts/gates/check-portability.mjs');
  } finally {
    sb.cleanup();
  }
}

const skill = (name, description, body = '# Body\n') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

describe('check-portability (NFR-DX-003)', () => {
  it('passes on the real harness', () => {
    const r = portability();
    assert.equal(r.status, 0, out(r));
  });

  const cases = {
    'vendor placeholder in a skill body': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => `${t}\nUse $ARGUMENTS here.\n`),
      /\$ARGUMENTS/,
    ],
    'Claude @import in AGENTS.md': [(sb) => sb.edit('AGENTS.md', (t) => `${t}\n@docs/standards/git.md\n`), /AGENTS\.md: @import/],
    'name different from directory': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('name: tdd', 'name: test-first')),
      /name 'test-first' must equal directory 'tdd'/,
    ],
    'name colliding with a built-in command': [
      (sb) => sb.write('.agents/skills/review/SKILL.md', skill('review', 'Review things. Use when reviewing.')),
      /collides with a built-in/,
    ],
    'skill longer than the cap': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t + 'line\n'.repeat(200)),
      /lines > 150/,
    ],
    'stale generated adapter': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('Implement a task test-first.', 'Implement a task test first, always.')),
      /stale adapter/,
    ],
    'description containing ": "': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('Implement a task test-first.', 'Rule: implement a task test-first.')),
      /breaks strict YAML/,
    ],
    'description that does not say when to use it': [
      (sb) => sb.write('.agents/skills/tdd/SKILL.md', skill('tdd', 'Implements tasks test-first.')),
      /must say when to use it/,
    ],
    'vendor-only frontmatter key': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t.replace('---\n\n', 'allowed-tools: Read\n---\n\n')),
      /vendor-only keys allowed-tools/,
    ],
    'skill missing from the AGENTS.md index': [
      (sb) => sb.edit('AGENTS.md', (t) => t.replace(/^\| \[`tdd`\].*\n/m, '')),
      /skill 'tdd' missing from index/,
    ],
    'CLAUDE.md that is not an adapter': [(sb) => sb.write('CLAUDE.md', '# Claude rules\n'), /CLAUDE\.md: must import/],
    'skill naming a script that does not exist': [
      (sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => `${t}\nRun node scripts/gates/check-nothing.mjs\n`),
      /names missing script scripts\/gates\/check-nothing\.mjs/,
    ],
  };

  for (const [name, [mutate, expected]] of Object.entries(cases)) {
    it(`fails on ${name}`, () => {
      const r = portability(mutate);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

  it('allows a missing script when the line names the milestone that adds it', () => {
    const r = portability((sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => `${t}\nLater: node scripts/gates/check-future.mjs (M7)\n`));
    assert.equal(r.status, 0, out(r));
  });
});
