import { describe, expect, it } from 'vitest';
import { documentFileSchema, schemaForRecord } from './document-file.js';

const text = (s: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] });

// the canonical example of 02-document-model §7 (its elided text filled in)
const example = {
  schemaVersion: '1.2',
  records: {
    doc: { id: 'doc', type: 'document', title: 'Checkout', themeId: 'th1' },
    th1: { id: 'th1', type: 'theme', name: 'Default', tokens: {} },
    s1: { id: 's1', type: 'screen', index: 'a0', name: 'Architecture', size: { w: 1920, h: 1080 } },
    e1: {
      id: 'e1',
      type: 'element',
      screenId: 's1',
      index: 'a0',
      kind: 'shape',
      defId: 'basic:rounded-rect',
      transform: { x: 200, y: 400, w: 240, h: 120, rot: 0 },
      style: { variant: 'emphasis' },
      text: text('API'),
      semantic: { slug: 'api' },
    },
    c1: {
      id: 'c1',
      type: 'element',
      screenId: 's1',
      index: 'a2',
      kind: 'connector',
      route: { type: 'orthogonal', cornerRadius: 8 },
      markers: { end: 'arrow' },
      riders: [{ shape: 'effects-core:dot', count: 5, speed: 40, loop: true }],
    },
    b1: { id: 'b1', type: 'binding', connectorId: 'c1', end: 'source', elementId: 'e1', anchor: { kind: 'auto' } },
  },
};

describe('document file', () => {
  it('FR-DOC-001: the 02-document-model example parses unchanged', () => {
    expect(documentFileSchema.parse(example)).toEqual(example);
  });

  it('FR-DOC-001: record schemas are picked by type and element kind', () => {
    expect(schemaForRecord({ type: 'screen' }).known).toBe(true);
    expect(schemaForRecord({ type: 'element', kind: 'shape' }).known).toBe(true);
    expect(schemaForRecord({ type: 'element', kind: 'acme:gauge' }).known).toBe(true);
    expect(schemaForRecord({ type: 'element', kind: 'hologram' }).known).toBe(false);
    expect(schemaForRecord({ type: 'hologram' }).known).toBe(false);
    expect(schemaForRecord(null).known).toBe(false);
  });

  it('FR-DOC-005: unknown record types and element kinds are kept verbatim', () => {
    const doc = {
      ...example,
      future: { sync: true },
      records: {
        ...example.records,
        x1: { id: 'x1', type: 'hologram', beam: [1, 2, 3] },
        x2: { id: 'x2', type: 'element', screenId: 's1', index: 'a3', kind: 'sticker', emoji: '✓' },
      },
    };
    expect(documentFileSchema.parse(doc)).toEqual(doc);
  });

  it('FR-DOC-004: a bad record fails with a path inside the records map and its own issue code', () => {
    const bad = { ...example, records: { ...example.records, e1: { ...example.records.e1, defId: undefined, transform: { x: 0, y: 0, w: -1, h: 1 } } } };
    const r = documentFileSchema.safeParse(bad);
    const issues = r.success ? [] : r.error.issues.map((i) => [i.path.join('/'), i.code]);
    // the inner Zod codes survive the record dispatch (M2.8 review F1)
    expect(issues).toEqual([
      ['records/e1/transform/w', 'too_small'],
      ['records/e1/defId', 'custom'],
    ]);
  });

  it('rejects a bad schema version and a record without id or type', () => {
    expect(documentFileSchema.safeParse({ ...example, schemaVersion: 'v1' }).success).toBe(false);
    // a version has no leading zeros: "1.00" would name the current version in another spelling
    for (const version of ['1.00', '01.0', '1.01', '1.', '.0', '1.0.0', ' 1.0'])
      expect(documentFileSchema.safeParse({ ...example, schemaVersion: version }).success, version).toBe(false);
    for (const version of ['1.0', '0.9', '1.10', '10.0'])
      expect(documentFileSchema.safeParse({ ...example, schemaVersion: version }).success, version).toBe(true);
    expect(documentFileSchema.safeParse({ ...example, records: { z: { type: 'hologram' } } }).success).toBe(false);
    expect(documentFileSchema.safeParse({ ...example, records: { z: { id: 'z' } } }).success).toBe(false);
    expect(documentFileSchema.safeParse({ schemaVersion: '1.2' }).success).toBe(false);
  });
});
