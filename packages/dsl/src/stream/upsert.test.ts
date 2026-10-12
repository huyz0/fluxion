import { type AnyRecord, type DocumentFile, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { registries } from '../decompile/registries.fixture.js';
import type { CompileOptions } from '../types.js';

const run = (text: string, extra: Partial<CompileOptions> = {}) => compile(text, { registries: registries(), salt: 'deck', ...extra });
const HEADER = 'flux: 1\ntitle: Deck\nuses: [basic]\nsettings: { autoplay: false }\n';
const ONE = '  - id: one\n    nodes:\n      a: { shape: rect, label: A }\n      b: { shape: rect, label: B }\n    edges:\n      - a -> b\n';
const TWO =
  '  - id: two\n    nodes:\n      c: { shape: rect, label: C }\n      d: { shape: rect, label: D }\n      e: { shape: rect, label: E }\n    edges:\n      - c -> d\n      - d -> e\n';
const THREE = '  - id: three\n    nodes:\n      f: { shape: rect }\n';
const deck = (...screens: string[]) => `${HEADER}screens:\n${screens.join('')}`;
const only = (...screens: string[]) => `flux: 1\nuses: [basic]\nscreens:\n${screens.join('')}`;

const records = (d: DocumentFile | undefined) =>
  Object.values(d?.records ?? {}) as unknown as {
    id: string;
    type: string;
    screenId?: string;
    meta?: { slug: string };
    semantic?: { slug: string };
    index?: string;
    source?: unknown;
  }[];
const screenId = (d: DocumentFile | undefined, slug: string) => records(d).find((r) => r.type === 'screen' && r.meta?.slug === slug)?.id;
/** The bytes of the records of one screen: the screen, its elements, and their bindings. */
function bytesOfScreen(d: DocumentFile | undefined, slug: string): string {
  const sid = screenId(d, slug);
  const elements = records(d).filter((r) => r.id === sid || r.screenId === sid);
  const ids = new Set(elements.map((r) => r.id));
  const bindings = records(d).filter((r) => r.type === 'binding' && ids.has((r as unknown as { connectorId: string }).connectorId));
  const picked = Object.fromEntries([...elements, ...bindings].map((r) => [r.id, r as unknown as AnyRecord]));
  return serializeDocument({ schemaVersion: '1.3', records: picked });
}
const slugs = (d: DocumentFile | undefined) =>
  records(d)
    .filter((r) => r.semantic?.slug)
    .map((r) => r.semantic?.slug);

describe('compile into a base document', () => {
  const base = run(deck(ONE, TWO)).doc as DocumentFile;

  it('FR-AI-010: with a base, an edited screen replaces its own records, keeps the ids of those that did not change, and leaves other screens byte-equal', () => {
    const edited =
      '  - id: two\n    nodes:\n      c: { shape: rect, label: C renamed }\n      d: { shape: rect, label: D }\n      g: { shape: rect, label: G }\n    edges:\n      - c -> d\n      - d -> g\n';
    const out = run(only(edited), { base });
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const doc = out.doc as DocumentFile;
    expect(bytesOfScreen(doc, 'one')).toBe(bytesOfScreen(base, 'one'));
    const [before, after] = [records(base), records(doc)];
    const byslug = (rs: typeof before, slug: string) => rs.find((r) => r.semantic?.slug === slug);
    // unchanged d keeps its id and bytes, c keeps its id with the new label, e is gone and g is new
    expect(byslug(after, 'd')?.id).toBe(byslug(before, 'd')?.id);
    expect(JSON.stringify(byslug(after, 'd'))).toBe(JSON.stringify(byslug(before, 'd')));
    expect(byslug(after, 'c')?.id).toBe(byslug(before, 'c')?.id);
    expect(JSON.stringify(byslug(after, 'c'))).not.toBe(JSON.stringify(byslug(before, 'c')));
    expect(byslug(after, 'e')).toBeUndefined();
    expect(byslug(after, 'g')).toBeDefined();
    // the screen is the one compiled from the whole edited deck
    expect(serializeDocument(doc)).toBe(serializeDocument(run(deck(ONE, edited)).doc as DocumentFile));
  });

  it('FR-AI-010: a node deleted from the text leaves with its connectors and bindings, and nothing dangles', () => {
    const without = '  - id: two\n    nodes:\n      c: { shape: rect, label: C }\n';
    const doc = run(only(without), { base }).doc as DocumentFile;
    const after = records(doc);
    expect(slugs(doc)).not.toContain('d');
    expect(after.filter((r) => r.type === 'binding')).toHaveLength(2);
    const ids = new Set(after.map((r) => r.id));
    for (const b of after.filter((r) => r.type === 'binding')) expect(ids.has((b as unknown as { connectorId: string }).connectorId)).toBe(true);
    expect(after.filter((r) => (r as unknown as { kind?: string }).kind === 'connector')).toHaveLength(1);
  });

  it('FR-AI-010: a screen block alone keeps the base title, theme, salt and header-level deferred sections, and replaces its own deferred ones', () => {
    const docOf = (d: DocumentFile | undefined) =>
      records(d).find((r) => r.type === 'document') as unknown as {
        title: string;
        themeId: string;
        source: { salt: string; deferred: { [p: string]: string } };
      };
    const archetype = '  - id: two\n    kind: title\n    title: Hello\n';
    const out = run(only(archetype), { base, salt: 'other' });
    const [was, now] = [docOf(base), docOf(out.doc)];
    expect(now.title).toBe('Deck');
    expect(now.themeId).toBe(was.themeId);
    expect(now.source.salt).toBe('deck');
    expect(now.source.deferred['/settings']).toBe(was.source.deferred['/settings']);
    expect(Object.keys(now.source.deferred).filter((p) => p.startsWith('/screens/two/'))).toEqual(['/screens/two/kind']);
    expect(Object.keys(was.source.deferred).some((p) => p.startsWith('/screens/two/'))).toBe(false);
  });

  it('FR-AI-010: a screen the base lacks is appended after the last, and a screen the text leaves out is kept', () => {
    const doc = run(only(THREE), { base }).doc as DocumentFile;
    const screens = records(doc).filter((r) => r.type === 'screen');
    expect(screens.sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : 1)).map((s) => s.meta?.slug)).toEqual(['one', 'two', 'three']);
    expect(serializeDocument(doc)).toBe(serializeDocument(run(deck(ONE, TWO, THREE)).doc as DocumentFile));
    expect(bytesOfScreen(doc, 'one')).toBe(bytesOfScreen(base, 'one'));
    expect(bytesOfScreen(doc, 'two')).toBe(bytesOfScreen(base, 'two'));
  });

  it('FR-AI-010: compile without a base is unchanged, and the base itself is not mutated', () => {
    const before = serializeDocument(base);
    run(only(THREE), { base });
    expect(serializeDocument(base)).toBe(before);
    expect(serializeDocument(run(deck(ONE, TWO)).doc as DocumentFile)).toBe(before);
  });

  it('FR-AI-010: a text that does not parse leaves no document, and so nothing to merge', () => {
    expect(run('screens: [', { base }).doc).toBeUndefined();
  });
});
