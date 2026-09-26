// NFR-DX-003: Claude and Codex adapters stay thin and run the same gate commands.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const json = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const commands = (hooks, event) => (hooks[event] ?? []).flatMap((h) => h.hooks.map((x) => x.command));

describe('tool adapters (NFR-DX-003)', () => {
  const claude = json('.claude/settings.json').hooks;
  const codex = json('.codex/hooks.json').hooks;

  it('run the same post-edit quick gate in Claude and Codex', () => {
    const quick = 'node scripts/gates/precommit.mjs --quick --summary';
    assert.deepEqual(commands(claude, 'PostToolUse'), [quick]);
    assert.deepEqual(commands(codex, 'PostToolUse'), [quick]);
  });

  it('match file-edit tools in each tool', () => {
    assert.match(claude.PostToolUse[0].matcher, /Edit/);
    assert.match(claude.PostToolUse[0].matcher, /Write/);
    assert.equal(codex.PostToolUse[0].matcher, 'apply_patch');
  });

  it('enable Codex hooks in the project config', () => {
    assert.match(readFileSync(join(REPO, '.codex/config.toml'), 'utf8'), /^\[features\]\s*\n(#.*\n)*hooks = true/m);
  });

  it('keep the Stop hook opt-in (never enabled alongside the /goal judge by default)', () => {
    assert.equal(claude.Stop, undefined);
    assert.equal(codex.Stop, undefined);
  });
});
