// NFR-MNT-007: public APIs have committed API reports and release tags; a signature change without an
// updated report fails check-api.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { linkInstalls, out, REPO, sandbox } from './helpers.mjs';

let sb;
const api = (...args) =>
  sb.node('scripts/gates/check-api.mjs', ['--dir', sb.dir, '--package', 'packages/core', ...args], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
const DTS = 'packages/core/dist/index.d.ts';
const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
/** Every workspace plus the configs TypeDoc reads, with the repo's install linked in. */
function fullCopy() {
  const full = sandbox(['scripts', 'tools', 'docs/architecture', 'typedoc.json', 'tsconfig.base.json', 'tsconfig.json', ...workspaces.map((w) => w.dir)]);
  linkInstalls(full);
  // TypeDoc follows project references into each dependency's .tsbuild declarations, which the
  // sandbox does not copy (TRANSIENT): build them here, as the ladder's typecheck does in the repo
  // (the copied workspaces only: the root solution also references e2e/, which is not copied)
  const tsc = [join(REPO, 'node_modules/typescript/bin/tsc'), '-b', ...workspaces.map((w) => w.dir)];
  const built = spawnSync(process.execPath, tsc, { cwd: full.dir, encoding: 'utf8' });
  assert.equal(built.status, 0, out(built));
  return full;
}

// one copy of the repo, built once, for both full-repo cases (M4.28: a full copy and build of every
// workspace is the costliest step of the harness); the passing case runs first, on the unedited copy
describe('check-api on a copy of the repo (NFR-MNT-007)', () => {
  let full;
  before(() => {
    full = fullCopy();
  });
  after(() => full?.cleanup());
  const check = () => full.node('scripts/gates/check-api.mjs', ['--dir', full.dir], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });

  it('passes on the real repo: every library matches its committed report', () => {
    // a copy of the repo: API Extractor writes temp reports and must not race the ladder's api step (M1.36)
    const r = check();
    assert.equal(r.status, 0, out(r));
    // one report per library that has one: the count follows the committed reports, so a new library does not edit this test
    const reports = ['packages', 'packs'].flatMap((d) => readdirSync(join(REPO, d)).filter((n) => existsSync(join(REPO, d, n, 'api'))));
    assert.ok(reports.length >= 17);
    assert.match(r.stdout, new RegExp(`${reports.length} API report\\(s\\) match`));
  });

  it('fails when a public export has no TSDoc (TypeDoc notDocumented, M1 cp3 F3)', () => {
    const index = 'packages/core/src/index.ts';
    const original = full.read(index);
    full.edit(index, (t) => `${t}\nexport const UNDOCUMENTED: number = 1;\n`);
    try {
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /typedoc \(typedoc\.json\)[\s\S]*UNDOCUMENTED/);
    } finally {
      full.write(index, original);
    }
  });
});

describe('check-api (NFR-MNT-007)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts', 'tools', 'packages/core']);
  });
  afterEach(() => sb.cleanup());

  it('fails when an exported signature changes without an updated report', () => {
    sb.edit(DTS, (t) => `${t}\n/**\n * Added.\n *\n * @public\n */\nexport declare const EXTRA: number;\n`);
    const r = api();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /public API changed: update the report/);
  });

  it('fails on an export without a release tag', () => {
    sb.edit(DTS, (t) => `${t}\n/** Untagged. */\nexport declare const UNTAGGED: number;\n`);
    const r = api();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /ae-missing-release-tag/);
  });

  it('--update rewrites the report, after which the check passes', () => {
    sb.edit(DTS, (t) => `${t}\n/**\n * Added.\n *\n * @public\n */\nexport declare const EXTRA: number;\n`);
    assert.equal(api('--update').status, 0);
    assert.match(sb.read('packages/core/api/core.api.md'), /export const EXTRA: number;/);
    const r = api();
    assert.equal(r.status, 0, out(r));
  });
});
