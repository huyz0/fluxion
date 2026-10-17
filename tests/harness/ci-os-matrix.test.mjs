// NFR-PORT-004: the CLI and MCP e2e tests run on Linux, Windows and macOS with Node 22 and 24, and ci-ok waits for them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
const job = /\n {2}cli-mcp:\n([\s\S]*?)\n {2}ci-ok:/.exec(ci)?.[1] ?? '';

describe('CI OS matrix for the CLI and MCP (NFR-PORT-004)', () => {
  it('NFR-PORT-004: the cli-mcp job lists three operating systems and Node 22 and 24', () => {
    assert.notEqual(job, '', 'a cli-mcp job exists');
    assert.match(job, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
    assert.match(job, /node-version: \[22, 24\]/);
    assert.match(job, /runs-on: \$\{\{ matrix\.os \}\}/);
    assert.match(job, /node-version: \$\{\{ matrix\.node-version \}\}/);
  });

  it('NFR-PORT-004: the job builds, then runs the CLI and MCP e2e tests', () => {
    assert.ok(job.indexOf('pnpm run build') > 0);
    assert.ok(job.indexOf('packages/cli/src/e2e') > job.indexOf('pnpm run build'));
    assert.match(job, /packages\/mcp\/src\/e2e/);
  });

  it('NFR-PORT-004: ci-ok needs the cli-mcp job, so a red cell blocks the merge', () => {
    assert.match(ci, /ci-ok:[\s\S]*?needs: \[[^\]]*\bcli-mcp\b/);
  });
});
