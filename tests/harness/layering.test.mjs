// NFR-MNT-001: the overview's dependency rules are enforced by check-layering (dependency-cruiser
// config built from tools/gen/workspaces.json dependsOn).
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { linkInstalls, out, REPO, sandbox } from './helpers.mjs';

const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
const SHARED = ['scripts', 'tools', 'docs/architecture', 'tsconfig.json', 'tsconfig.base.json', 'package.json', '.dependency-cruiser.mjs'];
let sb;
const extra = [];

function layering() {
  return sb.node('scripts/gates/check-layering.mjs', [], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
}
function put(path, text) {
  sb.write(path, text);
  extra.push(path);
}

describe('check-layering (NFR-MNT-001)', () => {
  before(() => {
    sb = sandbox(SHARED);
    // only what dependency-cruiser reads: sources and manifests (no dist, no node_modules links)
    for (const w of workspaces) {
      for (const f of ['src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, w.dir, f), sb.path(`${w.dir}/${f}`), { recursive: true });
    }
    // installed tools (vitest, …) resolve as in the repo; workspace links are absent on purpose
    linkInstalls(sb);
  });
  after(() => sb.cleanup());
  afterEach(() => {
    for (const p of extra.splice(0)) sb.write(p, 'export {};\n');
  });

  // one passing run for the real tree and the listed lower import planted in it (M18.157, as M16.31 did for the violations)
  let allowed;
  const allowedRun = () => {
    if (allowed === undefined) {
      put('packages/render/src/ok.ts', "import { VERSION } from '@fluxion/core';\nexport const v = VERSION;\n");
      allowed = layering();
    }
    return allowed;
  };

  it('passes on the real workspace tree', () => {
    const r = allowedRun();
    assert.equal(r.status, 0, out(r));
  });

  const violations = {
    'core importing render (upward)': ['packages/core/src/upward.ts', "import { VERSION } from '@fluxion/render';\nexport const v = VERSION;\n", /layer-core/],
    'player importing editor': ['packages/player/src/bad.ts', "export { VERSION } from '@fluxion/editor';\n", /player-not-editor/],
    'schema importing node:fs': ['packages/schema/src/bad.ts', "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n", /pure-no-node/],
    'a pure package importing React': ['packages/geometry/src/bad.ts', "import { useState } from 'react';\nexport const u = useState;\n", /pure-no-dom/],
    'a T0 test importing a DOM library': [
      'packages/render/src/view.test.ts',
      "import { render } from '@testing-library/react';\nexport const r = render;\n",
      /t0-tests-no-dom/,
    ],
    'a pack importing core': ['packs/basic/src/bad.ts', "export { VERSION } from '@fluxion/core';\n", /packs-sdk-only/],
    'a deep import into another package': ['packages/render/src/deep.ts', "export { VERSION } from '@fluxion/core/src/index.ts';\n", /no-deep-import/],
    'a relative import into another workspace': [
      'packages/render/src/relative.ts',
      "export { VERSION } from '../../core/src/index.ts';\n",
      /no-relative-cross-workspace/,
    ],
    'a T0 test importing vitest/browser': [
      'packages/render/src/b.test.ts',
      "import { page } from 'vitest/browser';\nexport const p = page;\n",
      /t0-tests-no-dom/,
    ],
    'shipped source importing an undeclared package': [
      'packages/core/src/undeclared.ts',
      "import { expect } from 'vitest';\nexport const e = expect;\n",
      /not-to-undeclared-dep/,
    ],
    'an unresolvable relative import': ['packages/core/src/unresolvable.ts', "export { x } from './missing.ts';\n", /not-to-unresolvable/],
    'a circular import': ['packages/core/src/a.ts', "import { b } from './b.ts';\nexport const a = (): number => b() + 1;\n", /no-circular/],
  };
  // one run with every violation planted, each in its own file (M16.31: a dependency-cruiser run over the tree per case was most of this
  // suite's time); every case asserts that its rule names its own file
  let planted;
  const plantedRun = () => {
    if (planted === undefined) {
      for (const [path, text] of Object.values(violations)) put(path, text);
      put('packages/core/src/b.ts', "import { a } from './a.ts';\nexport const b = (): number => a() - 1;\n");
      // shipped source importing a devDependency (M1 cp2 F7), in geometry so core's undeclared-vitest case keeps its own rule
      put(DEV_DEP, "import { expect } from 'vitest';\nexport const e = expect;\n");
      // a browser test may import DOM libraries (only T0 tests are restricted)
      put(BROWSER_TEST, "import { render } from '@testing-library/react';\nexport const r = render;\n");
      const manifest = sb.read('packages/geometry/package.json');
      sb.edit('packages/geometry/package.json', (t) => {
        const pkg = JSON.parse(t);
        return JSON.stringify({ ...pkg, devDependencies: { ...pkg.devDependencies, vitest: '5.0.2' } }, null, 2);
      });
      try {
        planted = layering();
      } finally {
        sb.write('packages/geometry/package.json', manifest);
      }
    }
    return planted;
  };
  const DEV_DEP = 'packages/geometry/src/devdep.ts';
  const BROWSER_TEST = 'packages/render/src/View.browser.test.ts';
  for (const [name, [path, , expected]] of Object.entries(violations)) {
    it(`fails on ${name}`, () => {
      const r = plantedRun();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, new RegExp(`${expected.source}: ${path.replaceAll('.', '\\.')}(?![\\w.])`));
    });
  }

  it('fails on shipped source importing a devDependency (M1 cp2 F7)', () => {
    const r = plantedRun();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /not-to-dev-dep: packages\/geometry\/src\/devdep\.ts(?![\w.])/);
  });

  it('fails loudly when the dependency-cruiser config is missing (M1.11 review F1)', () => {
    const config = sb.read('.dependency-cruiser.mjs');
    rmSync(sb.path('.dependency-cruiser.mjs'));
    try {
      const r = layering();
      assert.equal(r.status, 1, out(r));
    } finally {
      sb.write('.dependency-cruiser.mjs', config);
    }
  });

  it('allows a listed same-layer or lower import (render importing core)', () => {
    const r = allowedRun();
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(r.stderr, /ok\.ts/, out(r));
  });

  it('a browser test may import DOM libraries (only T0 tests are restricted)', () => {
    const r = plantedRun();
    // the planted T0 tests break the rule in the same run, so the run did judge it
    assert.match(r.stderr, /t0-tests-no-dom: packages\/render\/src\/view\.test\.ts/);
    assert.doesNotMatch(r.stderr, /t0-tests-no-dom: packages\/render\/src\/View\.browser\.test\.ts/, out(r));
  });

  describe('workspaces.json against the overview map', () => {
    const edit = (fn) => sb.edit('tools/gen/workspaces.json', (t) => JSON.stringify(fn(JSON.parse(t)), null, 2));
    let original;
    before(() => {
      original = sb.read('tools/gen/workspaces.json');
    });
    afterEach(() => {
      sb.write('tools/gen/workspaces.json', original);
      sb.write('docs/architecture/01-overview.md', sb.readRepo('docs/architecture/01-overview.md'));
    });

    // one run with the three edits, each on its own workspace (a dependency-cruiser run per case was most of this block's time, M19.60);
    // each case asserts its own line, and only the unlisted edge is reported as differing from the overview
    let mapRun;
    const mapped = () => {
      if (mapRun === undefined) {
        const add = { 'packages/core': 'theme', 'packages/theme': 'render', 'packages/sdk': 'basic' };
        edit((j) => ({ ...j, workspaces: j.workspaces.map((w) => (add[w.dir] ? { ...w, dependsOn: [...w.dependsOn, add[w.dir]] } : w)) }));
        sb.edit('docs/architecture/01-overview.md', (t) =>
          t
            .replace('| schema | ✅ |', '| schema, render | ✅ |')
            .replace('| core, render (types), schema, theme |', '| core, render (types), schema, theme, basic |'),
        );
        mapRun = layering();
      }
      return mapRun;
    };

    it('fails when a dependsOn edge is not in the overview', () => {
      const r = mapped();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /core dependsOn \[schema,geometry,theme\] != overview/);
      // the listed edges match the overview, so they are not reported as differing
      assert.doesNotMatch(r.stderr, /(theme|sdk) dependsOn .* != overview/);
    });

    it('fails when an edge points at a higher layer, even if the overview lists it', () => {
      const r = mapped();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /theme \(L1\) depends on higher layer render \(L3\)/);
    });

    it('packs sit at the host layer: a package below it may not bundle one, even if listed (ADR-0017)', () => {
      const r = mapped();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /sdk \(L4\) depends on higher layer basic \(Pack\)/);
    });
  });
});
