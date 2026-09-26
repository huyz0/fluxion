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
    assert.deepEqual(titles(src), ['-a', '-b', '-c', '-d', '-e', '-f', '-g', '+h']);
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
