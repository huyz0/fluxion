// NFR-DX-003: harness docs agree with the harness (M0 cp1 F3: one gate-test location).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { cleanEnv, REPO } from './helpers.mjs';

// Tracked Markdown only: scratch files under .harness/tmp (review packets) quote diffs verbatim.
const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
const files = tracked.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((p) => join(REPO, p));

describe('harness docs consistency (NFR-DX-003)', () => {
  it('name tests/harness as the only gate-test location', () => {
    const offenders = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (line.includes('__tests__') && !/not `scripts\/gates\/__tests__\/`/.test(line)) offenders.push(`${relative(REPO, f)}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, []);
  });

  it('describe the gate-test glob that precommit actually runs', () => {
    const pre = readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(pre, /'--test', 'tests\/harness\/\*\.test\.mjs'/);
  });
});
