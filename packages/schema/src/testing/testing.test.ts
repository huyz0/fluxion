import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { elementKindSchemas } from '../records/element-schemas.js';
import { parseDocument, serializeDocument } from '../serialize.js';
import { validate } from '../validate.js';
import { arbDocument, arbElement, arbRectOptions, documentBuilder, plainText } from './index.js';

// at least 1000 runs (M2.13 acceptance); the nightly FC_RUNS may ask for more
const runs = { numRuns: Math.max(1000, fc.readConfigureGlobal().numRuns ?? 0) };

describe('@fluxion/schema/testing', () => {
  it('FR-DOC-001: every generated doc validates with 0 errors', () => {
    fc.assert(
      fc.property(arbDocument, (doc) => {
        expect(validate(doc)).toEqual([]);
      }),
      runs,
    );
  });

  it('FR-DOC-001: every generated element is valid in its document (arbElement)', () => {
    const kinds = new Set<string>();
    fc.assert(
      fc.property(arbElement, ({ element, document }) => {
        kinds.add(element.kind);
        expect(document.records[element.id]).toBe(element);
        expect(elementKindSchemas[element.kind as 'shape' | 'text' | 'connector'].safeParse(element).success).toBe(true);
        expect(validate(document)).toEqual([]);
      }),
    );
    expect([...kinds].sort()).toEqual(['connector', 'shape', 'text']);
  });

  it('FR-DOC-001: parse(serialize(doc)) deep-equals doc over arbDocument', () => {
    fc.assert(
      fc.property(arbDocument, (doc) => {
        const text = serializeDocument(doc);
        const r = parseDocument(text);
        expect(r.ok && r.value.document).toEqual(doc);
        expect(r.ok && serializeDocument(r.value.document)).toBe(text);
      }),
    );
  });

  it('builds a two-rects-and-a-line document with deterministic ids and appended indices', () => {
    const build = () => {
      const b = documentBuilder({ title: 'Two rects', seed: 7 });
      const s = b.screen({ name: 'Main' });
      const a = b.rect(s, { x: 100, y: 100, label: 'A', slug: 'a' });
      const c = b.rect(s, { x: 400, y: 100, w: 120, h: 60, rot: 15, slug: 'c', style: { variant: 'emphasis' } });
      b.text(s, 'Title', { y: 20 });
      b.connect(a, c, { route: 'orthogonal', targetAnchor: { kind: 'side', side: 'w' } });
      b.connect({ x: 0, y: 0 }, a, { arrow: false });
      return { doc: b.build(), a, c };
    };
    const { doc, a, c } = build();
    expect(validate(doc)).toEqual([]);
    expect(serializeDocument(build().doc)).toBe(serializeDocument(doc));
    const records = Object.values(doc.records);
    expect(records.map((r) => r.type).sort()).toEqual([
      'binding',
      'binding',
      'binding',
      'document',
      'element',
      'element',
      'element',
      'element',
      'element',
      'screen',
    ]);
    const elements = records.filter((r) => r.type === 'element');
    expect(elements.map((e) => e['index'])).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(doc.records[a]).toMatchObject({
      kind: 'shape',
      defId: 'basic:rect',
      transform: { x: 100, y: 100, w: 160, h: 80 },
      text: plainText('A'),
      semantic: { slug: 'a' },
    });
    expect(doc.records[c]).toMatchObject({ transform: { rot: 15 }, style: { variant: 'emphasis' } });
    const free = elements.find((e) => e['freeSource'] !== undefined);
    expect(free).toMatchObject({ kind: 'connector', freeSource: { x: 0, y: 0 } });
    expect(free?.['markers']).toBeUndefined();
    const loose = documentBuilder();
    const screen = loose.screen();
    const line = loose.connect({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(loose.build().records[line]).toMatchObject({ screenId: screen, freeSource: { x: 0, y: 0 }, freeTarget: { x: 10, y: 10 } });
  });

  it('a new seed gives new ids; plain text of an empty string is an empty paragraph', () => {
    const ids = (seed: number) => Object.keys(documentBuilder({ seed }).build().records);
    expect(ids(1)).not.toEqual(ids(2));
    expect(plainText('')).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] });
    fc.assert(
      fc.property(arbRectOptions, (o) => {
        expect(o.w).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
