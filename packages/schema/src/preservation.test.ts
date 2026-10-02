import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { documentFileSchema } from './document-file.js';
import { parseDocument, serializeDocument } from './serialize.js';

// canonical text of a document full of data this version does not know: an unknown record type,
// a plugin element kind with props, an unknown core-style element kind, unknown fields at the top
// level, on records and deep inside known objects, an unknown rich-text node and mark
const FUTURE = {
  schemaVersion: '1.1',
  collab: { room: 'r1', peers: [1, 2], precision: 0.0001 },
  records: {
    doc: { id: 'doc', type: 'document', title: 'Future', settings: { grid: { size: 8, snap: true } } },
    s1: {
      id: 's1',
      type: 'screen',
      index: 'a0',
      background: {
        type: 'linear-gradient',
        stops: [
          { offset: 0, color: '#000', hint: 0.3 },
          { offset: 1, color: '#fff' },
        ],
        dither: true,
      },
    },
    e1: {
      id: 'e1',
      type: 'element',
      screenId: 's1',
      index: 'a0',
      kind: 'shape',
      defId: 'basic:rect',
      transform: { x: 1.5, y: 2, w: 3, h: 4, skew: { x: 0.12345 } },
      style: { fill: '{color.primary}', blend: 'multiply', font: { features: ['liga', 'tnum'] } },
      text: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { tone: 'info' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'sparkle', attrs: { speed: 2 } }] }] }],
          },
        ],
      },
      ai: { prompt: 'a box', confidence: 0.8754321 },
    },
    g1: {
      id: 'g1',
      type: 'element',
      screenId: 's1',
      index: 'a1',
      kind: 'acme:gauge',
      transform: { x: 0, y: 0, w: 10, h: 10 },
      props: { value: 42, bands: [{ from: 0, to: 30 }] },
    },
    h1: { id: 'h1', type: 'element', screenId: 's1', index: 'a2', kind: 'hologram', beam: { color: '#0ff', lumens: 900 } },
    x1: { id: 'x1', type: 'sticky-note', text: 'remember', at: { x: 5, y: 6 } },
  },
};

describe('preservation of unknown data (FR-DOC-005)', () => {
  it('FR-DOC-005: WHEN a doc with an unknown kind and unknown fields is parsed and serialized THE SYSTEM SHALL emit byte-equal canonical JSON', () => {
    const text = serializeDocument(documentFileSchema.parse(FUTURE));
    // anchored to the raw input, not to schema output: stripping anywhere would show here (M2.9 review F1)
    expect(JSON.parse(text)).toEqual(FUTURE);
    const r = parseDocument(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.document).toEqual(FUTURE);
    expect(serializeDocument(r.value.document)).toBe(text);
    // it was data the reader did not know, and it said so
    expect(r.value.diagnostics.map((d) => d.code).sort()).toEqual([
      'FLX_KIND_UNKNOWN',
      'FLX_RECORD_UNKNOWN_TYPE',
      'FLX_TEXT_UNKNOWN_MARK',
      'FLX_TEXT_UNKNOWN_NODE',
    ]);
  });

  it('FR-DOC-005: any extra field at any depth of a known record survives a round trip', () => {
    const key = fc.string({ minLength: 1, maxLength: 6 }).filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));
    // any double: only known geometry is rounded, extra data keeps every digit (M2.9 review r2);
    // -0 is written as 0 by rule (the last case), so the generator does not produce it
    const double = fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (n === 0 ? 0 : n));
    const value = fc.oneof(fc.string(), double, fc.boolean(), fc.constant(null), fc.array(double, { maxLength: 3 }));
    // where to add: the record itself, its transform, its style, or its style font
    const where = fc.constantFrom<readonly string[]>([], ['transform'], ['style'], ['style', 'font']);
    fc.assert(
      fc.property(where, key, value, (path, k, v) => {
        const doc = JSON.parse(JSON.stringify(FUTURE));
        let target = doc.records.e1;
        for (const p of path) target = target[p];
        target[`x_${k}`] = v;
        const text = serializeDocument(documentFileSchema.parse(doc));
        expect(JSON.parse(text)).toEqual(doc);
        const r = parseDocument(text);
        expect(r.ok && serializeDocument(r.value.document)).toBe(text);
        expect(r.ok && JSON.stringify(r.value.document)).toContain(JSON.stringify(`x_${k}`));
      }),
    );
  });

  it('writes -0 in extra data as 0, the one documented number change outside geometry', () => {
    const doc = JSON.parse(JSON.stringify(FUTURE));
    doc.records.e1.ai.offset = -0;
    const text = serializeDocument(documentFileSchema.parse(doc));
    expect(text).toContain('"offset": 0');
    expect(Object.is(JSON.parse(text).records.e1.ai.offset, 0)).toBe(true);
  });
});
