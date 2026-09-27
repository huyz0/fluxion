// FR-DOC-005 (M2.6): every object schema in @fluxion/schema keeps unknown keys. Zod's z.object
// strips them silently (M2 plan risk 1), so shipped schema sources may build objects only with
// z.looseObject; strict/strip modes and catchall(never) are banned too. The scan reads whole files
// with comments removed, so a chain the formatter splits across lines is still found (M2.6 r2 F1);
// checkedSchema also rejects a stripping object at compile time.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const STRIPPING = /\bz\s*\.\s*(?:object|strictObject)\s*\(|\.\s*(?:strict|strip)\s*\(\s*\)|\.\s*catchall\s*\(\s*z\s*\.\s*never\s*\(/;

const STRIPPING_ALL = new RegExp(STRIPPING.source, 'g');

/** Comments blanked out (newlines kept, so offsets still give line numbers). */
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

/** `line: match` for each stripping construct in one source text. */
function strippingIn(src) {
  const text = withoutComments(src);
  return [...text.matchAll(STRIPPING_ALL)].map((m) => `${text.slice(0, m.index).split('\n').length}: ${m[0].replace(/\s+/g, '')}`);
}

/** `file:line: match` for each stripping construct in the shipped .ts sources under `dir`. */
function strippingSchemas(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) hits.push(...strippingIn(readFileSync(p, 'utf8')).map((h) => `${relative(REPO, p)}:${h}`));
    }
  };
  walk(dir);
  return hits;
}

describe('schema objects keep unknown keys (FR-DOC-005)', () => {
  it('FR-DOC-005: no schema source strips unknown keys', () => {
    assert.deepEqual(strippingSchemas(join(REPO, 'packages', 'schema', 'src')), []);
  });

  it('flags z.object, z.strictObject, .strict(), .strip() and catchall(z.never())', () => {
    const bad = ['z.object({ a: z.string() })', 'z.strictObject({})', 'z.looseObject({}).strict()', 'x.strip()', 'z.looseObject({}).catchall(z.never())'];
    for (const line of bad) assert.ok(STRIPPING.test(line), line);
    for (const line of ['z.looseObject({ a: z.string() })', 'z.record(z.string(), z.unknown())', 'objectSchema(x)']) assert.ok(!STRIPPING.test(line), line);
  });

  it('finds a chain split across lines and ignores comments (M2.6 r2 F1)', () => {
    const src = [
      'const a = {',
      '  b: z',
      '    .object({ c: z.string() })',
      '    .optional(),',
      '};',
      '// z.object( in a comment',
      '/* z.strictObject( */',
      'const d = z.looseObject({})',
      '  .strict();',
    ].join('\n');
    assert.deepEqual(strippingIn(src), ['2: z.object(', '9: .strict()']);
  });
});
