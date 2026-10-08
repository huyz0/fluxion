import { createCoreRegistries, idKeys, type ShapeDef, sha256Hash128, stableId } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { type DocumentFile, type RecordId, SCHEMA_VERSION, serializeDocument, validate } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { CHECKOUT } from './read/checkout.fixture.js';
import type { CompileOptions, CompileResult } from './types.js';

/** Registries with the shapes the checkout example uses, two themes and the built-in layouts, as a host would have after its packs. */
function registries() {
  const r = createCoreRegistries();
  const sized: { readonly [id: string]: { w: number; h: number } } = { 'basic:rounded-rect': { w: 200, h: 100 }, 'flowchart:database': { w: 120, h: 140 } };
  for (const id of ['basic:rect', 'basic:rounded-rect', 'flowchart:database', 'flowchart:queue', 'icons-lucide:globe', 'effects-core:dot'])
    r.shapeDefs.register(id, { id, ...(sized[id] ? { defaultSize: sized[id] } : {}) } as unknown as ShapeDef, id.split(':')[0] ?? id);
  r.themes.register('themes-core:light', { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' }, 'themes-core');
  r.themes.register('themes-core:ocean', { ...LIGHT_THEME, id: 'themes-core:ocean', name: 'ocean' }, 'themes-core');
  registerBuiltInLayouts(r.layouts);
  return r;
}

const run = (text: string, options: Partial<CompileOptions> = {}): CompileResult => compile(text, { registries: registries(), ...options });
const doc = (body: string) => `flux: 1\ntitle: Checkout\nuses: [basic]\nscreens:\n${body}`;
const errors = (r: CompileResult) => r.diagnostics.filter((d) => d.severity === 'error');
const brief = (r: CompileResult) => r.diagnostics.map((d) => ({ code: d.code, severity: d.severity, line: d.source?.line }));
const id = (key: string, salt = '') => stableId(sha256Hash128, salt, key) as RecordId;
const field = (r: CompileResult, key: string, name: string) => (r.doc?.records[id(key)] as unknown as { readonly [k: string]: unknown } | undefined)?.[name];

// a node whose pinned width the schema refuses (a box is never negative): read, resolve, expand and place all take it
const NEGATIVE_WIDTH = doc('  - id: a\n    nodes:\n      ok: { shape: rect }\n      bad: { shape: rect, pin: { x: 0, y: 0, w: -5, h: 10 } }\n');
// a screen background that is no colour: an optional field the schema refuses, which lenient mode can remove
const BAD_BACKGROUND = doc('  - id: a\n    title: A\n  - id: b\n    background: notacolor\n    nodes:\n      x: { shape: rect }\n');

describe('compile', () => {
  it('FR-DSL-001: the checkout example compiles twice to byte-identical .flux.json, with only FLX_DSL_NOT_YET warnings', () => {
    const [a, b] = [run(CHECKOUT), run(CHECKOUT)];
    expect(a.doc).toBeDefined();
    const bytes = serializeDocument(a.doc as DocumentFile);
    expect(serializeDocument(b.doc as DocumentFile)).toBe(bytes);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new Set(a.diagnostics.map((d) => `${d.code} ${d.severity}`))).toEqual(new Set(['FLX_DSL_NOT_YET warning']));
    expect(validate(JSON.parse(bytes)).filter((d) => d.severity === 'error')).toEqual([]);
    expect(a.doc?.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('FR-DSL-001: every record maps to a source range: its construct, else (a theme the file does not name) the whole file', () => {
    const r = run(CHECKOUT);
    const ids = Object.keys(r.doc?.records ?? {}).sort();
    expect([...r.sourceMap.keys()]).toEqual(ids);
    expect(r.sourceMap.get(id(idKeys.screen('arch')))?.line).toBe(10);
    expect(r.sourceMap.get(id('node:queue'))?.line).toBe(18);
    expect(r.sourceMap.get(id(idKeys.document()))?.line).toBe(2);
    const themeOf = (x: CompileResult) => x.sourceMap.get(field(x, idKeys.document(), 'themeId') as RecordId);
    // the preset names the theme
    expect(themeOf(r)).toMatchObject({ line: 3, col: 18 });
    // a file without `theme:` gets the default theme, which comes from the file as a whole
    const plain = run(NEGATIVE_WIDTH);
    expect(themeOf(plain)).toMatchObject({ line: 1, col: 1, offset: 0 });
    expect([...plain.sourceMap.keys()]).toEqual(Object.keys(plain.doc?.records ?? {}).sort());
  });

  it('FR-DSL-006: a schema problem is a diagnostic at its source line, with the schema code and document pointer', () => {
    const r = run(NEGATIVE_WIDTH);
    expect(brief(r)).toEqual([{ code: 'FLX_SCHEMA_INVALID', severity: 'error', line: 8 }]);
    expect(r.diagnostics[0]?.path).toBe(`/records/${id('node:bad')}/transform/w`);
    expect(r.diagnostics[0]?.source).toMatchObject({ line: 8, col: 7 });
    // strict keeps the document, so the problem can be shown on the canvas and the source
    expect(r.doc?.records[id('node:bad')]).toBeDefined();
  });

  it('FR-DSL-006: schema problems come in source order whatever their record ids', () => {
    const text = doc(
      '  - id: a\n    background: nope\n    nodes:\n      x: { shape: rect, pin: { x: 0, y: 0, w: -1, h: 1 } }\n  - id: b\n    background: nada\n',
    );
    expect(brief(run(text)).map((d) => d.line)).toEqual([5, 8, 9]);
  });

  it('FR-DSL-006: strict (default) reports a refused field as an error; lenient removes it and warns, naming what it removed', () => {
    const strict = run(BAD_BACKGROUND);
    expect(brief(strict)).toEqual([{ code: 'FLX_SCHEMA_INVALID', severity: 'error', line: 7 }]);
    expect(field(strict, idKeys.screen('b'), 'background')).toBe('notacolor');
    expect(run(BAD_BACKGROUND, { mode: 'strict' })).toEqual(strict);
    const lenient = run(BAD_BACKGROUND, { mode: 'lenient' });
    expect(brief(lenient)).toEqual([{ code: 'FLX_SCHEMA_INVALID', severity: 'warning', line: 7 }]);
    expect(lenient.diagnostics[0]?.message).toContain(`removed /records/${id(idKeys.screen('b'))}/background`);
    expect(field(lenient, idKeys.screen('b'), 'background')).toBeUndefined();
    expect(validate(lenient.doc).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('FR-DSL-006: lenient keeps an error no removal fixes without a new error (a required box field)', () => {
    const r = run(NEGATIVE_WIDTH, { mode: 'lenient' });
    expect(brief(r)).toEqual([{ code: 'FLX_SCHEMA_INVALID', severity: 'error', line: 8 }]);
    expect(field(r, 'node:bad', 'transform')).toMatchObject({ w: -5 });
  });

  it('FR-DSL-006: a parse error stops the compile: FLX_DSL_SYNTAX, no document, empty source map', () => {
    const r = run('flux: 1\ntitle: [unclosed\n');
    expect(r.doc).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toContain('FLX_DSL_SYNTAX');
    expect(errors(r).every((d) => d.code === 'FLX_DSL_SYNTAX' && d.source !== undefined)).toBe(true);
    expect(r.sourceMap.size).toBe(0);
    expect(r.stats).toEqual({ screens: 0, records: 0 });
  });

  it('FR-DSL-006: a file without flux: 1 stops after the read stage with FLX_DSL_VERSION and no document', () => {
    const r = run('title: Checkout\nscreens: []\n');
    expect(r.doc).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(['FLX_DSL_VERSION']);
  });

  it('FR-DSL-006: problems of the later stages are all reported, in stage order, with a document still built', () => {
    const text = doc('  - id: a\n    background: nope\n    nodes:\n      x: { shape: nope }\n      y: { shape: rect }\n');
    const r = run(text);
    expect(brief(r)).toEqual([
      { code: 'FLX_DSL_UNKNOWN_SHAPE', severity: 'error', line: 8 },
      { code: 'FLX_SCHEMA_INVALID', severity: 'error', line: 5 },
    ]);
    expect(r.doc).toBeDefined();
  });

  it('FR-DSL-001: stats count the screens and records of the document', () => {
    const r = run(CHECKOUT);
    const records = Object.values(r.doc?.records ?? {});
    expect(r.stats).toEqual({ screens: 4, records: records.length });
    // a document, a theme, four screens, ten elements and eight bindings
    expect(r.stats.records).toBe(24);
  });

  it('FR-DSL-001: ids come from the salt and hasher of the options; a base document kept salt wins (ADR-0031)', () => {
    const salted = run(NEGATIVE_WIDTH, { salt: 's1' });
    expect(salted.doc?.records[id('node:ok', 's1')]).toBeDefined();
    const base = salted.doc as DocumentFile;
    const again = run(NEGATIVE_WIDTH, { salt: 'other', base });
    expect(Object.keys(again.doc?.records ?? {}).sort()).toEqual(Object.keys(base.records).sort());
    const hasher = { hash128: (t: string) => sha256Hash128.hash128(`x${t}`) };
    expect(run(NEGATIVE_WIDTH, { hasher }).doc?.records[stableId(hasher, '', 'node:ok')]).toBeDefined();
  });
});
