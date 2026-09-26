// NFR-MNT-008: the title scanner behind check-trace reads titles only from code and knows which
// tests run (M1.25; M1 cp2 F1; M1.13 review minors).
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are JS source fixtures for the scanner
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testTitles } from '../../scripts/gates/test-titles.mjs';

const titles = (src) => testTitles(src).map((t) => `${t.runs ? '+' : '-'}${t.title}`);

describe('testTitles (NFR-MNT-008)', () => {
  it('reads it/test/describe titles, member chains and .each forms', () => {
    const src = [
      "describe('suite', () => {",
      "  it('plain', () => {});",
      "  test.concurrent('concurrent', () => {});",
      "  it.each(Object.entries(cases))('each %s', () => {});",
      "  it.each`a | b`('tagged $a', () => {});",
      "  test.describe('pw describe', () => {});",
      '  it(`template ${x}`, () => {});',
      '});',
    ].join('\n');
    assert.deepEqual(titles(src), ['+suite', '+plain', '+concurrent', '+each %s', '+tagged $a', '+pw describe', '+template ${x}']);
  });

  it('marks skip/todo in every form as not running', () => {
    const src = [
      "it.skip('a', () => {});",
      "it.todo('b');",
      "describe.skipIf(ci)('c', () => {});",
      "it.runIf(ci)('d', () => {});",
      "it.concurrent.skip('e', () => {});",
      "it('f', { skip: true }, () => {});",
      "it('g', { todo: 'later' }, () => {});",
      "it('h', { skip: false }, () => {});",
      "xit('i', () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['-a', '-b', '-c', '-d', '-e', '-f', '-g', '+h', '-i']);
  });

  it('tests inside a skipped or todo suite do not run (M1.25 review F1)', () => {
    const src = [
      "describe.skip('a', () => {\n  it('a1', () => {});\n});",
      "describe('b', { skip: true }, () => {\n  describe('b-inner', () => { it('b1', () => {}); });\n});",
      "describe.todo('c', () => { it('c1', () => {}); });",
      "describe.skipIf(ci)('d', () => { it('d1', () => {}); });",
      "describe('e', () => { it('e1', () => {}); });",
      "it('f', () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['-a', '-a1', '-b', '-b-inner', '-b1', '-c', '-c1', '-d', '-d1', '+e', '+e1', '+f']);
  });

  it('quarantined and expected-to-fail tests do not count as running (M1.25 review r2 F1)', () => {
    const src = [
      "test.fixme('a', async () => {});",
      "test.describe.fixme('b', () => { test('b1', async () => {}); });",
      "it.fails('c', () => {});",
      "test.fail('d', async () => {});",
      "test('e', async () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['-a', '-b', '-b1', '-c', '-d', '+e']);
  });

  it('a runtime skip inside a body skips the innermost enclosing test', () => {
    const src = [
      "test.describe('suite', () => {",
      "  test('a', async ({ browserName }) => { test.skip(browserName === 'webkit', 'flaky'); });",
      "  it('b', (t) => { t.skip(); });",
      "  it('c', (ctx) => { ctx.skip(); });",
      "  it('d', (t) => { t.todo('later'); });",
      "  test('e', async () => { test.fixme(); });",
      "  test('f', async () => { expect(1).toBe(1); });",
      '});',
    ].join('\n');
    assert.deepEqual(titles(src), ['+suite', '-a', '-b', '-c', '-d', '-e', '+f']);
  });

  it('assertion helpers and other receivers are not runtime skips (M1.29, M1.25 r3 F1)', () => {
    const src = [
      "it('a', () => { try { f(); assert.fail('should throw'); } catch {} });",
      "it('b', () => { if (x) expect.fail('nope'); });",
      "it('c', () => { iter.skip(2); });",
      "it('d', (t) => { other.skip(); });",
      "it('e', async (t) => { t.skip(); });",
      "it('f', function (context) { context.todo('later'); });",
    ].join('\n');
    assert.deepEqual(titles(src), ['+a', '+b', '+c', '+d', '-e', '-f']);
  });

  it('reads options with nested objects and the fails option (M1.29, M1.25 r3 F2)', () => {
    const src = [
      "it('a', { skip: true, meta: { a: 1 } }, () => {});",
      "it('b', { fails: true }, () => {});",
      "it('c', { timeout: 5, meta: { skip: false } }, () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['-a', '-b', '+c']);
  });

  it('a runner skip outside any test skips the whole file, as in Playwright (M1.29, M1.25 r3 F3)', () => {
    const src = ["test.skip(({ browserName }) => browserName === 'webkit');", "test('a', async () => {});", "test('b', async () => {});"].join('\n');
    assert.deepEqual(titles(src), ['-a', '-b']);
  });

  it('reads expression titles, so data-driven cases can be skipped or focused visibly (M1.29 review F2)', () => {
    const src = ['for (const c of CASES) it(c.name, () => {});', "it.skip(c['name'], () => {});", 'it.only(fmt(c), () => {});'].join('\n');
    assert.deepEqual(
      testTitles(src).map((t) => `${t.runs ? '+' : '-'}${t.title}${t.focused ? '!' : ''}`),
      ['+<c.name>', "-<c['name']>", '+<fmt(c)>!'],
    );
  });

  it('shorthand, spread and variable options and a destructured skip count as skipping (M1.29 review F3)', () => {
    const src = [
      "it('a', { skip }, () => {});",
      "it('b', { ...opts }, () => {});",
      "it('c', opts, () => {});",
      "it('d', ({ skip }) => { skip(); });",
      "it('e', ({ expect }) => { expect(1).toBe(1); });",
    ].join('\n');
    assert.deepEqual(titles(src), ['-a', '-b', '-c', '-d', '+e']);
  });

  it('hooks and config calls are not tests; Playwright test.describe is a suite (M1.29 review r2)', () => {
    const src = [
      'test.beforeEach(resetDb);',
      'test.setTimeout(TIMEOUT);',
      "test.describe.configure({ mode: 'serial' });",
      "test.describe('s', () => {});",
      "it.each(rows)('row %s', () => {});",
    ].join('\n');
    assert.deepEqual(
      testTitles(src).map((t) => `${t.kind}:${t.title}`),
      ['describe:s', 'it:row %s'],
    );
  });

  it('Playwright steps are reported as steps, not cases', () => {
    const src = "test('t', async () => { await test.step('open', async () => {}); });";
    assert.deepEqual(
      testTitles(src).map((t) => `${t.kind}:${t.title}`),
      ['test:t', 'step:open'],
    );
  });

  it('test.skip(cond) and test.skip(cond, reason) are runtime skips, not declarations', () => {
    assert.deepEqual(titles("test.describe('d', () => {\n  test.skip(isMobile, 'no hover');\n  test('a', async () => {});\n});\ntest('b', async () => {});"), [
      '-d',
      '-a',
      '+b',
    ]);
    assert.deepEqual(titles("test.skip(isCI);\ntest('c', async () => {});"), ['-c']);
  });

  it('reports kind and focus (.only, { only: true }) for check-tests-kept', () => {
    const src = ["describe.only('s', () => {});", "it('a', { only: true }, () => {});", "test('b', () => {});"].join('\n');
    assert.deepEqual(
      testTitles(src).map(({ kind, focused }) => `${kind}:${focused}`),
      ['describe:true', 'it:true', 'test:false'],
    );
  });

  it('a match starting inside a string does not swallow the code after it (M1.25 review r2 F2)', () => {
    const src = ['const s = "it(\'";', "describe.skip('x', () => { it('y', () => {}); });", "it('z', () => {});"].join('\n');
    assert.deepEqual(titles(src), ['-x', '-y', '+z']);
  });

  it('ignores calls inside comments, strings, templates and regex literals', () => {
    const src = [
      "// it('line comment', () => {});",
      "/* it('block comment', () => {}); */",
      "/** it('jsdoc') */",
      "const a = \"describe('s', () => { it('in double quotes', () => {}) })\";",
      'const b = \'it("in single quotes")\';',
      "const c = `it('in template text')`;",
      "const d = /it\\('in a regex'/;",
      "it('real', () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['+real']);
  });

  it('keeps reading after a glob string that contains /* (M1.13 review F1)', () => {
    const src = [
      "const GLOB = 'packages/*/package.json';",
      "it('after the glob', () => {});",
      '/** helper */',
      'function h() {}',
      "it('after the jsdoc', () => {});",
    ].join('\n');
    assert.deepEqual(titles(src), ['+after the glob', '+after the jsdoc']);
  });

  it('reads code inside template expressions and resumes the template after them', () => {
    const src = ["const s = `a ${cond ? 'x' : 'y'} b it('not a test')`;", "it('after', () => {});"].join('\n');
    assert.deepEqual(titles(src), ['+after']);
  });

  it('tells division from a regex literal', () => {
    const src = ["const r = total / count; it('after division', () => {});", "const q = x.replace(/'/g, ''); it('after regex', () => {});"].join('\n');
    assert.deepEqual(titles(src), ['+after division', '+after regex']);
  });
});
