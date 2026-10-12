import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { registries } from '../decompile/registries.fixture.js';
import type { CompileOptions, CompileResult, DslDiagnostic } from '../types.js';
import { createStreamCompiler, type StreamUpdate } from './compile-stream.js';
import { STREAM_TEXTS } from './stream.fixture.js';

const options = (extra: Partial<CompileOptions> = {}): CompileOptions => ({ registries: registries(), salt: 'deck', ...extra });
const whole = (text: string, extra: Partial<CompileOptions> = {}): CompileResult => compile(text, options(extra));
const bytes = (d: DocumentFile | undefined) => serializeDocument(d as DocumentFile);

/** Feed `text` in pieces of `sizes` (cycled), end it, and return every update. */
function stream(text: string, sizes: readonly number[], extra: Partial<CompileOptions> = {}) {
  const compiler = createStreamCompiler(options(extra));
  const updates: StreamUpdate[] = [];
  for (let at = 0, i = 0; at < text.length; i++) {
    const size = Math.max(1, sizes[i % sizes.length] ?? 1);
    updates.push(compiler.push(text.slice(at, at + size)));
    at += size;
  }
  updates.push(compiler.end());
  return { compiler, updates };
}
const lines = (text: string) => (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((l) => l.length);
/** A diagnostic by what it says and where, whatever the pointer (a screen's pointer is its index in the file compiled). */
const said = (d: DslDiagnostic) => `${d.code}|${d.severity}|${d.message}|${d.source?.line}:${d.source?.col}`;
const diagnosticsOf = (updates: readonly StreamUpdate[]) =>
  updates
    .flatMap((u) => [...(u.header?.diagnostics ?? []), ...u.screens.flatMap((s) => s.diagnostics), ...(u.tail?.diagnostics ?? [])])
    .map(said)
    .sort();

describe('stream compiler', () => {
  it('FR-AI-010: fed line by line, each screen arrives when its block completes, in source order, and the result is the whole-file compile', () => {
    for (const [name, text] of Object.entries(STREAM_TEXTS)) {
      const { compiler, updates } = stream(text, lines(text));
      const expected = whole(text);
      expect(bytes(compiler.doc), name).toBe(bytes(expected.doc));
      expect(diagnosticsOf(updates), name).toEqual(expected.diagnostics.map(said).sort());
      const arrived = updates.flatMap((u) => u.screens.map((s) => s.id));
      const written = Object.values(expected.doc?.records ?? {}).filter((r) => r.type === 'screen');
      expect(arrived, name).toEqual(
        written
          .sort((a, b) => ((a as { index: string }).index < (b as { index: string }).index ? -1 : 1))
          .map((r) => (r as unknown as { meta: { slug: string } }).meta.slug),
      );
    }
  });

  it('FR-AI-010: the checkout example streams its screens one update at a time, the last one at end()', () => {
    const text = STREAM_TEXTS['checkout'] as string;
    const { updates } = stream(text, lines(text));
    const counts = updates.map((u) => u.screens.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(counts.slice(0, -1).every((n) => n <= 1)).toBe(true);
    expect(counts.at(-1)).toBe(1);
    expect(updates.filter((u) => u.header)).toHaveLength(1);
    // each update's document holds the screens so far and no half one: the screen count grows by one per screen
    const seen = updates.flatMap((u) => u.screens.map((s) => Object.values(s.doc?.records ?? {}).filter((r) => r.type === 'screen').length));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('FR-AI-010: char by char and in random chunks give the same document and diagnostics as the whole file', () => {
    const texts = Object.values(STREAM_TEXTS);
    for (const text of texts) expect(bytes(stream(text, [1]).compiler.doc)).toBe(bytes(whole(text).doc));
    fc.assert(
      fc.property(fc.constantFrom(...texts), fc.array(fc.integer({ min: 1, max: 90 }), { minLength: 1, maxLength: 6 }), (text, sizes) => {
        const { compiler, updates } = stream(text, sizes);
        expect(bytes(compiler.doc)).toBe(bytes(whole(text).doc));
        expect(diagnosticsOf(updates)).toEqual(whole(text).diagnostics.map(said).sort());
      }),
      { seed: 12018, numRuns: 25 },
    );
  });

  it('FR-AI-010: a screen with a syntax error reports its own diagnostics, and the screens after it still compile', () => {
    const text =
      'flux: 1\nuses: [basic]\nscreens:\n  - id: one\n    nodes:\n      a: { shape: rect }\n  - id: broken\n    nodes: [oops\n  - id: three\n    nodes:\n      c: { shape: rect }\n';
    const { compiler, updates } = stream(text, lines(text));
    const screens = updates.flatMap((u) => u.screens);
    expect(screens.map((s) => [s.id, s.compiled])).toEqual([
      ['one', true],
      ['broken', false],
      ['three', true],
    ]);
    expect(screens[0]?.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(screens[2]?.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(screens[1]?.diagnostics.some((d) => d.severity === 'error' && (d.source?.line ?? 0) >= 7)).toBe(true);
    const slugs = Object.values(compiler.doc?.records ?? {}).flatMap((r) =>
      r.type === 'screen' ? [(r as unknown as { meta: { slug: string } }).meta.slug] : [],
    );
    expect(slugs.sort()).toEqual(['one', 'three']);
  });

  it('FR-AI-010: the header is compiled once, with its own diagnostics, and a block reports only its own', () => {
    const text =
      'flux: 1\ntheme: nosuch\nuses: [basic]\nscreens:\n  - id: one\n    nodes:\n      a: { shape: rect }\n  - id: two\n    nodes:\n      b: { shape: rect }\n';
    const { updates } = stream(text, lines(text));
    const header = updates.find((u) => u.header)?.header;
    expect(header?.diagnostics.some((d) => (d.source?.line ?? 0) === 2)).toBe(true);
    for (const s of updates.flatMap((u) => u.screens)) expect(s.diagnostics.every((d) => (d.source?.line ?? 0) > 4)).toBe(true);
    expect(diagnosticsOf(updates)).toEqual(whole(text).diagnostics.map(said).sort());
  });

  it('FR-AI-010: a stream into a base document upserts its screens and keeps the rest of the base', () => {
    const base = whole(STREAM_TEXTS['screens at column 0'] as string).doc as DocumentFile;
    const text = 'flux: 1\nuses: [basic]\nscreens:\n  - id: two\n    nodes:\n      d: { shape: rect }\n  - id: three\n    nodes:\n      e: { shape: rect }\n';
    const { compiler } = stream(text, lines(text), { base });
    const doc = compiler.doc as DocumentFile;
    const screens = Object.values(doc.records).filter((r) => r.type === 'screen') as unknown as { meta: { slug: string }; index: string }[];
    expect(screens.sort((a, b) => (a.index < b.index ? -1 : 1)).map((s) => s.meta.slug)).toEqual(['one', 'two', 'three']);
    expect(Object.values(doc.records).some((r) => (r as { title?: string }).title === 'Flat')).toBe(true);
  });
});

describe('stream compiler: keys after the screens', () => {
  const screens = '  - id: one\n    nodes:\n      a: { shape: rect }\n';
  const withTail = (tail: string) => `flux: 1\n${tail.includes('title') ? '' : 'title: T\n'}screens:\n${screens}${tail}`;

  it('FR-AI-010: uses, title and theme written after the screens give the whole-file document at end(), recompiled', () => {
    for (const tail of ['uses: [basic]\n', 'title: Late\nuses: [basic]\n', 'uses: [basic]\ntheme: ocean\n']) {
      const text = withTail(tail);
      const { compiler, updates } = stream(text, lines(text));
      const expected = whole(text);
      expect(bytes(compiler.doc), tail).toBe(bytes(expected.doc));
      expect(updates.at(-1)?.recompiled, tail).toBe(true);
      expect(updates.at(-1)?.tail?.diagnostics.map(said).sort(), tail).toEqual(expected.diagnostics.map(said).sort());
    }
  });

  it('FR-AI-010: settings after the screens is a plain tail: no recompile, still the whole-file document', () => {
    const text = `flux: 1\ntitle: T\nuses: [basic]\nscreens:\n${screens}settings: { autoplay: false }\n`;
    const { compiler, updates } = stream(text, lines(text));
    expect(updates.some((u) => u.recompiled)).toBe(false);
    expect(bytes(compiler.doc)).toBe(bytes(whole(text).doc));
  });

  it('FR-AI-010: a diagnostic without a source range is reported once in the whole stream, not once per screen', () => {
    const text =
      'flux: 1\nuses: [basic]\nscreens:\n  - id: one\n    nodes:\n      a: { shape: rect }\n  - id: two\n    nodes:\n      b: { shape: rect }\n  - id: three\n    nodes:\n      c: { shape: rect }\n';
    const { updates } = stream(text, lines(text));
    const all = updates.flatMap((u) => [...(u.header?.diagnostics ?? []), ...u.screens.flatMap((s) => s.diagnostics)]);
    const sourceless = all.filter((d) => !d.source).map((d) => `${d.code}|${d.path}|${d.message}`);
    expect(new Set(sourceless).size).toBe(sourceless.length);
    expect(diagnosticsOf(updates)).toEqual(whole(text).diagnostics.map(said).sort());
  });
});
