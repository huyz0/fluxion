// NFR-MNT-007: public APIs have committed API reports and release tags; a signature change without an
// updated report fails check-api.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
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
  return full;
}

describe('check-api (NFR-MNT-007)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts', 'tools', 'packages/core']);
  });
  afterEach(() => sb.cleanup());

  it('passes on the real repo: every library matches its committed report', () => {
    // a copy of the repo: API Extractor writes temp reports and must not race the ladder's api step (M1.36)
    const full = fullCopy();
    try {
      const r = full.node('scripts/gates/check-api.mjs', ['--dir', full.dir], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /17 API report\(s\) match/);
    } finally {
      full.cleanup();
    }
  });

  it('fails when a public export has no TSDoc (TypeDoc notDocumented, M1 cp3 F3)', () => {
    const full = fullCopy();
    try {
      full.edit('packages/core/src/index.ts', (t) => `${t}\nexport const UNDOCUMENTED: number = 1;\n`);
      const r = full.node('scripts/gates/check-api.mjs', ['--dir', full.dir], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /typedoc \(typedoc\.json\)[\s\S]*UNDOCUMENTED/);
    } finally {
      full.cleanup();
    }
  });

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
