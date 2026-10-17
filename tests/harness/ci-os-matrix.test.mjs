// NFR-PORT-004: the CLI and MCP e2e tests run on Linux, Windows and macOS with Node 22 and 24, and ci-ok waits for them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

// `yaml` is a dependency of @fluxion/dsl, not of the root: resolve it from there
const { parse } = createRequire(join(REPO, 'packages/dsl/package.json'))('yaml');
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

  it('NFR-PORT-004: parsed as YAML, the cli-mcp job has the three-OS, two-Node matrix and a step that runs both e2e directories', () => {
    const doc = parse(ci);
    const cell = doc.jobs['cli-mcp'];
    assert.deepEqual(cell.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
    assert.deepEqual(cell.strategy.matrix['node-version'], [22, 24]);
    assert.equal(cell.strategy['fail-fast'], false);
    assert.equal(cell['runs-on'], '${{ matrix.os }}');
    const runs = cell.steps.map((x) => x.run ?? '');
    assert.ok(
      runs.some((r) => r.includes('packages/cli/src/e2e') && r.includes('packages/mcp/src/e2e')),
      'one step runs both e2e directories',
    );
    assert.ok(doc.jobs['ci-ok'].needs.includes('cli-mcp'), 'ci-ok waits for cli-mcp');
  });
});
