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
    // one report per entry point (a library's main entry and each subpath its exports list, M10.29): the count follows the committed reports,
    // so a new library or subpath does not edit this test
    const reports = ['packages', 'packs'].flatMap((d) =>
      readdirSync(join(REPO, d)).flatMap((n) =>
        existsSync(join(REPO, d, n, 'api')) ? readdirSync(join(REPO, d, n, 'api')).filter((f) => f.endsWith('.api.md')) : [],
      ),
    );
    assert.ok(reports.length >= 20);
    assert.ok(reports.includes('player.mount.api.md') && reports.includes('schema.testing.api.md') && reports.includes('core.testing.api.md'));
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

// a subpath entry of a package's exports is a contract too (M10.29): `@fluxion/player/mount` and the `testing` entries have their own reports
describe('check-api on a subpath entry (NFR-MNT-008)', () => {
  const TESTING_DTS = 'packages/schema/dist/testing/index.d.ts';
  const schemaApi = (...args) =>
    sb.node('scripts/gates/check-api.mjs', ['--dir', sb.dir, '--package', 'packages/schema', ...args], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
  beforeEach(() => {
    sb = sandbox(['scripts', 'tools', 'packages/schema']);
  });
  afterEach(() => sb.cleanup());

  it('NFR-MNT-008: the subpath entries are checked against their own committed reports', () => {
    const r = schemaApi();
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /2 API report\(s\) match/);
  });

  it('NFR-MNT-008: an exported signature of a subpath entry changing without an updated report fails, naming the subpath', () => {
    sb.edit(TESTING_DTS, (t) => `${t}\n/**\n * Added.\n *\n * @public\n */\nexport declare const EXTRA_TESTING: number;\n`);
    const r = schemaApi();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /packages\/schema \(testing\)/);
    assert.match(r.stderr, /public API changed: update the report/);
  });

  it('NFR-MNT-008: --update writes the subpath report', () => {
    sb.edit(TESTING_DTS, (t) => `${t}\n/**\n * Added.\n *\n * @public\n */\nexport declare const EXTRA_TESTING: number;\n`);
    assert.equal(schemaApi('--update').status, 0);
    assert.match(sb.read('packages/schema/api/schema.testing.api.md'), /export const EXTRA_TESTING: number;/);
    assert.equal(schemaApi().status, 0);
  });

  it('NFR-MNT-008: a subpath export with no types file fails instead of dropping out of the gate', () => {
    sb.edit('packages/schema/package.json', (t) => t.replace('"exports": {', '"exports": {\n    "./bare": "./dist/bare.js",'));
    const r = schemaApi();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /the export "\.\/bare" has no "types" file/);
  });
});
