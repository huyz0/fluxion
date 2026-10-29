// One shared pack test (M18.129, FR-LIB-007, HARNESS, ADR-0199): every first-party pack's src/pack.test.ts takes its write-run
// guard and comparison from @fluxion/sdk/testing's testShapePack and passes only its source and its import.meta.glob results;
// a suite that compares, snapshots or reads the write variable itself fails here.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

/** What a pack's suite must not do itself: the helper owns comparing, writing and the write guard. */
const OWN = [
  [/toMatchFileSnapshot|toEqual|toBe\(/, 'asserts itself'],
  [/VITE_FLUXION_WRITE_PACK['"\]]|import\.meta\.env/, 'reads the write variable'],
  [/\b(checkShapePack|shapePackExpectation)\b/, 'calls the suite directly'],
  [/\bit\(|\btest\(/, 'registers its own test'],
];

/** The problems of one pack suite's text: it must import and call testShapePack, and do nothing the helper owns. */
function packTestProblems(text) {
  const problems = [];
  if (!/import \{ testShapePack \} from '@fluxion\/sdk\/testing';/.test(text)) problems.push('does not import testShapePack from @fluxion/sdk/testing');
  if (!/\btestShapePack\(\w+Source, \{/.test(text)) problems.push('does not call testShapePack with its source and globs');
  // the header comment documents the write run, so only code lines are judged
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  for (const [re, what] of OWN) if (re.test(code)) problems.push(what);
  return problems;
}

/** Every first-party declarative pack: a pack directory with a checked-in `pack/` distribution. */
const packs = () =>
  readdirSync(join(REPO, 'packs'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(REPO, 'packs', e.name, 'pack', 'index.json')))
    .map((e) => e.name);

describe('one shared pack test (M18.129, FR-LIB-007, HARNESS)', () => {
  it('every declarative pack has a suite that only calls testShapePack', () => {
    const found = packs();
    assert.ok(found.length >= 12, `found ${found.length} declarative packs`);
    const problems = found.flatMap((name) => {
      const file = join(REPO, 'packs', name, 'src', 'pack.test.ts');
      if (!existsSync(file)) return [`packs/${name}: no src/pack.test.ts`];
      return packTestProblems(readFileSync(file, 'utf8')).map((p) => `packs/${name}/src/pack.test.ts ${p}`);
    });
    assert.deepEqual(problems, []);
  });

  it('a suite that compares or writes by itself, or never calls the helper, fails', () => {
    const good = readFileSync(join(REPO, 'packs', 'basic', 'src', 'pack.test.ts'), 'utf8');
    assert.deepEqual(packTestProblems(good), []);
    const own = good.replace(
      /testShapePack\(basicSource, \{[\s\S]*?\n {2}\}\);/,
      "it('x', async () => expect(await checkShapePack(basicSource, files)).toEqual({}));",
    );
    assert.deepEqual(packTestProblems(own), [
      'does not call testShapePack with its source and globs',
      'asserts itself',
      'calls the suite directly',
      'registers its own test',
    ]);
    const writer = `${good}\nconst WRITE = import.meta.env?.['VITE_FLUXION_WRITE_PACK'] === '1';\n`;
    assert.deepEqual(packTestProblems(writer), ['reads the write variable']);
    assert.deepEqual(packTestProblems(good.replace("import { testShapePack } from '@fluxion/sdk/testing';\n", '')), [
      'does not import testShapePack from @fluxion/sdk/testing',
    ]);
  });
});
