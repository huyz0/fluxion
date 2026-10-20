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
/**
 * core and the libraries it depends on, with the configs TypeDoc reads and the repo's install linked in: TypeDoc follows project references
 * into each dependency's .tsbuild declarations, which the sandbox does not copy (TRANSIENT), so they are built here (M16.31: three libraries,
 * not every workspace; the ladder's own api step checks the whole repo).
 */
function coreCopy() {
  const libs = ['packages/schema', 'packages/geometry', 'packages/core'];
  // docs/architecture: the READMEs link into it, and TypeDoc warns (an error here) on a link to a missing file
  const copy = sandbox(['scripts', 'tools', 'typedoc.json', 'tsconfig.base.json', 'docs/architecture', ...libs]);
  linkInstalls(copy);
  const built = spawnSync(process.execPath, [join(REPO, 'node_modules/typescript/bin/tsc'), '-b', ...libs], { cwd: copy.dir, encoding: 'utf8' });
  assert.equal(built.status, 0, out(built));
  return copy;
}

// every library entry has its committed report: the ladder's api step checks them all against the code on the real repo (M10.29: one report per
// entry point, a library's main entry and each subpath its exports list)
it('NFR-MNT-007: the libraries and their subpath entries have committed API reports', () => {
  const reports = ['packages', 'packs'].flatMap((d) =>
    readdirSync(join(REPO, d)).flatMap((n) =>
      existsSync(join(REPO, d, n, 'api')) ? readdirSync(join(REPO, d, n, 'api')).filter((f) => f.endsWith('.api.md')) : [],
    ),
  );
  assert.ok(reports.length >= 20);
  assert.ok(reports.includes('player.mount.api.md') && reports.includes('schema.testing.api.md') && reports.includes('core.testing.api.md'));
});

// one copy, built once, for both cases; the passing case runs first, on the unedited copy
describe('check-api with TypeDoc on a copy of core (NFR-MNT-007)', () => {
  let copy;
  before(() => {
    copy = coreCopy();
  });
  after(() => copy?.cleanup());
  const check = () =>
    copy.node('scripts/gates/check-api.mjs', ['--dir', copy.dir, '--package', 'packages/core', '--typedoc'], {
      env: { ...process.env, FLUXION_TOOLS_ROOT: REPO },
    });

  it('passes on core as committed: its report matches and every export is documented', () => {
    const r = check();
    assert.equal(r.status, 0, out(r));
    // both of core's entries were compared: its main entry and ./testing
    assert.match(r.stdout, /^api: 2 API report\(s\) match$/m);
  });

  it('fails when a public export has no TSDoc (TypeDoc notDocumented, M1 cp3 F3)', () => {
    const index = 'packages/core/src/index.ts';
    const original = copy.read(index);
    copy.edit(
      index,
      (t) => `${t}
export const UNDOCUMENTED: number = 1;
`,
    );
    try {
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /typedoc \(typedoc\.json\)[\s\S]*UNDOCUMENTED/);
    } finally {
      copy.write(index, original);
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

  it('M11.39: one library alone leaves TypeDoc to --typedoc, which runs it (here with no typedoc.json to read)', () => {
    assert.equal(api().status, 0);
    const r = api('--typedoc');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /typedoc \(typedoc\.json\)/);
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

  it('NFR-MNT-007: an entry the gate no longer finds fails on its committed report instead of comparing fewer reports (M16.32)', () => {
    sb.edit('packages/schema/package.json', (t) => {
      const pkg = JSON.parse(t);
      delete pkg.exports['./testing'];
      return JSON.stringify(pkg, null, 2);
    });
    const r = schemaApi();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /api\/schema\.testing\.api\.md is committed but no entry of the package reports it/);
  });

  it('NFR-MNT-007: a stale committed report fails (M16.32)', () => {
    sb.write('packages/schema/api/schema.ghost.api.md', '## API Report File for "@fluxion/schema/ghost"\n');
    const r = schemaApi();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /api\/schema\.ghost\.api\.md is committed but no entry of the package reports it/);
  });

  it('NFR-MNT-007: the whole-repo run fails on a folder with reports that is not a library of workspaces.json (M16.32)', () => {
    sb.edit('tools/gen/workspaces.json', (t) => {
      const w = JSON.parse(t);
      return JSON.stringify({ ...w, workspaces: w.workspaces.filter((x) => x.dir === 'packages/schema') }, null, 2);
    });
    sb.write('packages/ghost/api/ghost.api.md', '## API Report File for "@fluxion/ghost"\n');
    const r = sb.node('scripts/gates/check-api.mjs', ['--dir', sb.dir], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /packages\/ghost: has committed API reports but is not a library in tools\/gen\/workspaces\.json/);
  });
});
