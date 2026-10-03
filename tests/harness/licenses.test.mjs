// NFR-LIC-001 / NFR-LIC-002: shipped dependencies are permissive, copyleft only in its named packs,
// never GPL-family or watermark libraries, and every workspace is MIT.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
let sb;
const listing = (entries) =>
  JSON.stringify(
    entries.reduce((acc, [name, license]) => {
      acc[license] = [...(acc[license] ?? []), { name, versions: ['1.0.0'] }];
      return acc;
    }, {}),
  );
function licenses(files = {}) {
  for (const [key, entries] of Object.entries(files)) sb.write(`listings/${key}.json`, listing(entries));
  return sb.node('scripts/gates/check-licenses.mjs', ['--dir', sb.dir, '--json-dir', sb.path('listings')]);
}

describe('check-licenses (NFR-LIC-001, NFR-LIC-002)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts', 'tools', 'LICENSE', 'NOTICE', ...workspaces.map((w) => w.dir)]);
  });
  afterEach(() => sb.cleanup());

  it('passes on the real repo (pnpm licenses list)', () => {
    const real = sb.node('scripts/gates/check-licenses.mjs', ['--dir', REPO]);
    assert.equal(real.status, 0, out(real));
  });

  it('passes permissive shipped deps, OR expressions and permissive-but-unlisted dev tools', () => {
    const r = licenses({
      prod: [
        ['a', 'MIT'],
        ['b', 'MIT OR GPL-3.0-only'],
        ['c', '(Apache-2.0 OR MIT)'],
      ],
      dev: [['lru-cache', 'BlueOak-1.0.0']],
    });
    assert.equal(r.status, 0, out(r));
  });

  const bad = {
    'a GPL shipped dependency': [{ prod: [['gpl-lib', 'GPL-3.0-only']] }, /gpl-lib@1\.0\.0 \(GPL-3\.0-only\)/],
    'a GPL dev tool': [{ dev: [['gpl-tool', 'GPL-2.0-or-later']] }, /gpl-tool@1\.0\.0 \(GPL-2\.0-or-later\): licence is never allowed/],
    'a grouped expression that still requires GPL (M1.15 review r2 F1)': [{ prod: [['grouped', '(MIT OR Apache-2.0) AND GPL-3.0-only']] }, /grouped@1\.0\.0/],
    'a free-text GPL licence on a dev tool (M1.15 review r2 F2)': [
      { dev: [['old-tool', 'GNU General Public License v3']] },
      /old-tool@1\.0\.0 .*never allowed/,
    ],
    'a free-text GNU GPLv3 on a dev tool': [{ dev: [['gnu-tool', 'GNU GPLv3']] }, /gnu-tool@1\.0\.0 .*never allowed/],
    'an AND with a denied part': [{ prod: [['mixed', 'MIT AND AGPL-3.0-only']] }, /mixed@1\.0\.0/],
    'an unlisted licence in shipped code': [{ prod: [['blue', 'BlueOak-1.0.0']] }, /blue@1\.0\.0 \(BlueOak-1\.0\.0\) is not an allowed licence/],
    'EPL outside its named pack': [{ prod: [['elkjs', 'EPL-2.0']] }, /packages\/apps: elkjs@1\.0\.0 \(EPL-2\.0\)/],
    'EPL in a different pack': [{ 'pack-basic': [['elkjs', 'EPL-2.0']] }, /packs\/basic: elkjs@1\.0\.0 \(EPL-2\.0\)/],
    'a watermark library with an MIT licence field': [{ dev: [['bpmn-js', 'MIT']] }, /bpmn-js@1\.0\.0 \(MIT\): watermark or licence-key library/],
  };
  for (const [name, [files, expected]] of Object.entries(bad)) {
    it(`fails on ${name}`, () => {
      const r = licenses(files);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

  it('fails closed when pnpm licenses list fails (M1.15 review F1)', () => {
    sb.write('listings/dev.fail', '[ERROR] bad pnpm-workspace.yaml');
    const r = licenses();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /pnpm licenses list --dev --recursive failed/);
  });

  it('denies GPL-family licences however they are spelled (M1.15 review F3)', () => {
    for (const spelling of ['GPL', 'GPLv3', 'gpl-3.0', 'GPL-3.0+', 'agpl-3.0-only', 'SSPL-1.0']) {
      const r = licenses({ dev: [['x', spelling]] });
      assert.equal(r.status, 1, `${spelling}\n${out(r)}`);
    }
    const lgpl = licenses({ dev: [['y', 'LGPL-3.0-only']] });
    const lesser = licenses({ dev: [['z', 'GNU Lesser General Public License v3']] });
    assert.equal(lesser.status, 0, out(lesser));
    // M1.34 (M1.15 review r3): one-token free text is denied; Lesser/Library GPL in any spelling is not
    for (const spelling of ['GNU-GPL-3.0', 'GNU/GPLv3', 'GNU_GPL', 'library: GPL-3.0', 'Lesser, GPL', 'SmallLibrary GPL'])
      assert.equal(licenses({ dev: [['w', spelling]] }).status, 1, spelling);
    for (const spelling of ['GNU Lesser GPL v3', 'GNU Library GPL', 'GNU-LGPL-3.0', 'GNU.Lesser.GPL', 'GNU Lesser  GPL']) {
      const r = licenses({ dev: [['v', spelling]] });
      assert.equal(r.status, 0, `${spelling}\n${out(r)}`);
    }
    assert.equal(lgpl.status, 0, out(lgpl));
  });

  it('allows EPL only in packs/layouts-elk (its named pack)', () => {
    sb.write('packs/layouts-elk/package.json', JSON.stringify({ name: '@fluxion/pack-layouts-elk', license: 'MIT' }));
    sb.write('packs/layouts-elk/LICENSE', sb.read('LICENSE'));
    sb.edit('tools/gen/workspaces.json', (t) => {
      const j = JSON.parse(t);
      j.workspaces.push({ dir: 'packs/layouts-elk', name: '@fluxion/pack-layouts-elk', layer: 'Pack', runtime: 'dom', dependsOn: ['sdk'], desc: 'elk' });
      return JSON.stringify(j);
    });
    const r = licenses({ 'pack-layouts-elk': [['elkjs', 'EPL-2.0']] });
    assert.equal(r.status, 0, out(r));
  });

  it('FR-THM-008: a font under OFL-1.1 passes the font allowlist and one under another licence fails', () => {
    const bytes = 'font bytes';
    const sha = createHash('sha256').update(bytes).digest('hex');
    const manifest = (fonts) => sb.write('packs/basic/fonts.json', JSON.stringify({ fonts }));
    sb.write('packs/basic/fonts/a.woff2', bytes);
    const ok = { file: 'fonts/a.woff2', license: 'OFL-1.1', sha256: sha };
    manifest([ok]);
    sb.write(
      'packs/basic/catalog.json',
      JSON.stringify({
        families: [
          { name: 'Inter', license: 'OFL-1.1' },
          { name: 'Roboto', license: 'Apache-2.0' },
        ],
      }),
    );
    assert.equal(licenses().status, 0, out(licenses()));
    const failing = (fonts, why) => {
      manifest(fonts);
      const r = licenses();
      assert.equal(r.status, 1, why);
      return out(r);
    };
    assert.match(failing([{ ...ok, license: 'UFL-1.0' }], 'other licence'), /UFL-1\.0 is not on the font allowlist/);
    assert.match(failing([{ ...ok, license: undefined }], 'no licence'), /a font has no licence/);
    assert.match(failing([{ ...ok, sha256: undefined }], 'no hash'), /a font has no hash/);
    assert.match(failing([{ ...ok, sha256: 'ab' }], 'wrong hash'), /hash differs/);
    assert.match(failing([{ ...ok, file: 'fonts/gone.woff2' }], 'missing file'), /the file is missing/);
    assert.match(failing([{ ...ok, file: '../fonts/a.woff2' }], 'leaves the pack'), /outside the pack/);
    assert.match(failing([{ ...ok, file: '/etc/hostname' }], 'absolute'), /outside the pack/);
    manifest([ok]);
    sb.write('packs/basic/catalog.json', JSON.stringify({ families: [{ name: 'Ubuntu', license: 'LicenseRef-UFL' }] }));
    assert.match(out(licenses()), /Ubuntu: font licence LicenseRef-UFL is not on the font allowlist/);
  });

  it('fails when a package LICENSE is missing, a package is not MIT, or NOTICE is missing (NFR-LIC-001)', () => {
    rmSync(sb.path('packages/core/LICENSE'));
    sb.edit('packages/geometry/package.json', (t) => t.replace('"license": "MIT"', '"license": "ISC"'));
    rmSync(sb.path('NOTICE'));
    const r = licenses();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /packages\/core\/LICENSE is missing or not MIT/);
    assert.match(r.stderr, /packages\/geometry\/package\.json license is ISC, not MIT/);
    assert.match(r.stderr, /NOTICE at the repo root is missing/);
  });
});
