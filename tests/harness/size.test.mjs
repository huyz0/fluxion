// NFR-MNT-003: size caps on harness docs and code files.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

function size(mutate = () => {}) {
  const sb = sandbox(['scripts', '.agents', 'AGENTS.md', 'docs/backlog', '.harness/progress.md']);
  try {
    mutate(sb);
    return sb.node('scripts/gates/check-size.mjs', ['--all']);
  } finally {
    sb.cleanup();
  }
}

describe('check-size (NFR-MNT-003)', () => {
  it('passes on the real harness', () => {
    const r = size();
    assert.equal(r.status, 0, out(r));
  });

  const cases = {
    'AGENTS.md over 250 lines': [(sb) => sb.edit('AGENTS.md', (t) => t + 'x\n'.repeat(260)), /AGENTS\.md: \d+ lines > 250/],
    'a skill over 150 lines': [(sb) => sb.edit('.agents/skills/tdd/SKILL.md', (t) => t + 'x\n'.repeat(160)), /SKILL\.md: \d+ lines > 150/],
    'a progress entry over 10 lines': [
      (sb) => sb.edit('.harness/progress.md', (t) => `${t}\n## big entry\n${'line\n'.repeat(11)}`),
      /entry "big entry" has 11 lines > 10/,
    ],
    'a backlog over 400 lines': [(sb) => sb.edit('docs/backlog/current.md', (t) => t + '| x |\n'.repeat(420)), /current\.md: \d+ lines > 400/],
    'a package AGENTS.md over 60 lines': [(sb) => sb.write('packages/core/AGENTS.md', 'x\n'.repeat(61)), /packages\/core\/AGENTS\.md: 61 lines > 60/],
    'a utils.ts in a package source': [(sb) => sb.write('packages/core/src/utils.ts', 'export const a = 1;\n'), /utils\.ts: 'utils' is a grab-bag name/],
    'a helpers test file in an app source': [(sb) => sb.write('apps/studio/src/Helpers.test.tsx', 'export {};\n'), /'helpers' is a grab-bag name/],
    'a misc module in a pack': [(sb) => sb.write('packs/basic/src/shapes/misc.ts', 'export {};\n'), /misc\.ts: 'misc'/],
    'a common module': [(sb) => sb.write('packages/render/src/common.mts', 'export {};\n'), /common\.mts: 'common'/],
    'a utils directory': [(sb) => sb.write('packages/core/src/utils/index.ts', 'export {};\n'), /utils\/index\.ts: 'utils'/],
    'a helpers.cjs file': [(sb) => sb.write('packages/core/src/helpers.cjs', 'module.exports = {};\n'), /helpers\.cjs: 'helpers'/],
    'a source .cts file over 400 lines': [(sb) => sb.write('packages/core/src/big.cts', 'export const a = 1;\n'.repeat(401)), /big\.cts: 401 lines > 400/],
    'a source file over 400 lines': [(sb) => sb.write('packages/core/src/big.ts', 'export const a = 1;\n'.repeat(401)), /big\.ts: 401 lines > 400/],
  };
  for (const [name, [mutate, expected]] of Object.entries(cases)) {
    it(`fails on ${name}`, () => {
      const r = size(mutate);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, expected);
    });
  }

  it('accepts files exactly at the cap and ignores fixtures, generated code and .d.ts', () => {
    const r = size((sb) => {
      sb.write('packages/core/src/edge.ts', 'export const a = 1;\n'.repeat(400));
      sb.write('packages/core/src/__fixtures__/huge.ts', 'x\n'.repeat(900));
      sb.write('packages/core/src/types.d.ts', 'x\n'.repeat(900));
      sb.write('packages/core/src/generated/schema.ts', 'x\n'.repeat(900));
      // concept names that merely contain a denylisted word are fine
      sb.write('packages/core/src/common-ancestor.ts', 'export {};\n');
      sb.write('packages/core/src/anchor-utils-free.ts', 'export {};\n');
      sb.write('.harness/progress.md', `# log\n\n## ok\n${'line\n'.repeat(10)}`);
    });
    assert.equal(r.status, 0, out(r));
  });
});
