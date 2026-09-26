// NFR-DX-003: harness docs agree with the harness (M0 cp1 F3: one gate-test location).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { belowFloor } from '../../scripts/gates/lib.mjs';
import { cleanEnv, out, REPO, sandbox } from './helpers.mjs';

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

  // M1.37 (M1 cp2 F4, cp3 F4): the docs agents follow say what the toolchain does
  const read = (p) => readFileSync(join(REPO, p), 'utf8');
  const workspacesDirs = () => JSON.parse(read('tools/gen/workspaces.json')).workspaces.map((w) => w.dir);

  it('tech-stack names the engines floor and TS 6 only through the typescript6 catalog', () => {
    const stack = read('docs/standards/tech-stack.md');
    const floor = /(\d+\.\d+)/.exec(JSON.parse(read('package.json')).engines.node)[1];
    assert.match(stack, new RegExp(`Node\\.js LTS \\| ≥ ${floor.replace('.', '\\.')} `));
    assert.match(stack, /API Extractor bundles its own compiler/);
    assert.doesNotMatch(stack, /API Extractor\/TypeDoc\/Stryker need the TS 6/);
    assert.match(stack, /`typescript6` catalog, the single TS 6 pin/);
  });

  it('the typescript6 catalog is the only TS 6 pin in the repo (lockfile aside)', () => {
    const pins = spawnSync(
      'git',
      ['grep', '-l', 'npm:typescript@6', '--', '.', ':!pnpm-lock.yaml', ':!docs/**', ':!.harness/**', ':!tests/harness/docs-consistency.test.mjs'],
      { cwd: REPO, encoding: 'utf8', env: cleanEnv() },
    );
    assert.deepEqual(pins.stdout.split(/\r?\n/).filter(Boolean), ['pnpm-workspace.yaml']);
    const ws = read('pnpm-workspace.yaml');
    assert.equal(ws.match(/npm:typescript@6/g)?.length, 1, 'one TS 6 version string');
    // pnpm allows no catalog: specifier in packageExtensions, so the catalog reuses the one string (YAML anchor)
    assert.match(ws, /typescript: &typescript6 npm:typescript@6/);
    assert.match(ws, /typescript6:\r?\n {4}typescript: \*typescript6/);
    // no package pins TypeScript by version: TS 7 comes from the default catalog, TS 6 from typescript6
    for (const manifest of ['package.json', ...workspacesDirs().map((d) => `${d}/package.json`)]) {
      const pkg = JSON.parse(read(manifest));
      for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
        const spec = deps?.typescript;
        if (spec !== undefined) assert.ok(['catalog:', 'catalog:typescript6'].includes(spec), `${manifest}: typescript ${spec}`);
      }
    }
  });

  it('API reports live at packages/*/api/*.api.md, as check-api writes them', () => {
    assert.match(read('docs/architecture/09-extensibility.md'), /`packages\/\*\/api\/\*\.api\.md`/);
    assert.match(read('scripts/gates/check-api.mjs'), /reportFolder: '<projectFolder>\/api\/'/);
  });

  it('new-package steps use the generator and workspaces.json, and M1.md no longer says tsgo', () => {
    const steps = read('docs/standards/code-structure.md');
    assert.match(steps, /node tools\/gen\/package\.mjs <dir>/);
    assert.doesNotMatch(steps, /pnpm gen package|Add its layer rule to `\.dependency-cruiser\.mjs`/);
    assert.doesNotMatch(read('docs/milestones/M1.md'), /tsgo/);
  });

  it('ADR-0011 records its corrections in an Amendments section (documentation.md rule 8)', () => {
    assert.match(read('docs/standards/documentation.md'), /`## Amendments` section/);
    const adr = read('docs/architecture/decisions/ADR-0011-source-resolution-dual-compiler.md');
    const amendments = adr.split(/^## Amendments$/m)[1] ?? '';
    const lines = amendments.split(/\r?\n/).filter((l) => l.startsWith('- '));
    assert.ok(lines.length >= 3, 'amendment lines');
    for (const l of lines) assert.match(l, /^- \d{4}-\d{2}-\d{2} \(M\d+\.\d+\): /, l);
    // the TS 6 route it records is the one pnpm-workspace.yaml uses
    assert.match(amendments, /`&typescript6`/);
    assert.doesNotMatch(amendments, /references it \(`catalog:typescript6`\)/);
  });

  it('setup.mjs refuses a Node below the package.json engines floor', () => {
    assert.match(read('scripts/harness/setup.mjs'), /belowFloor\(process\.versions\.node, engines\)/);
    assert.equal(belowFloor('22.18.9', '>=22.19'), true);
    assert.equal(belowFloor('21.99.0', '>=22.19'), true);
    assert.equal(belowFloor('22.19.0', '>=22.19'), false);
    assert.equal(belowFloor('24.1.0', '>=22.19'), false);
    // and setup.mjs itself exits 1 on it (other steps also fail in a bare sandbox; the message is the floor's)
    const sb = sandbox(['scripts', 'package.json']);
    try {
      sb.edit('package.json', (t) => JSON.stringify({ ...JSON.parse(t), engines: { node: '>=99.0' } }));
      const high = sb.node('scripts/harness/setup.mjs');
      assert.equal(high.status, 1, out(high));
      assert.match(high.stderr, /is below the engines floor >=99\.0/);
      sb.edit('package.json', (t) => JSON.stringify({ ...JSON.parse(t), engines: { node: '>=1.0' } }));
      assert.doesNotMatch(sb.node('scripts/harness/setup.mjs').stderr, /below the engines floor/);
    } finally {
      sb.cleanup();
    }
  });
});
