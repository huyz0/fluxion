import { describe, expect, it } from 'vitest';
import connectorsExpected from './__fixtures__/invalid/connectors.expected.json' with { type: 'json' };
import connectors from './__fixtures__/invalid/connectors.flux.json' with { type: 'json' };
import hierarchyExpected from './__fixtures__/invalid/hierarchy.expected.json' with { type: 'json' };
import hierarchy from './__fixtures__/invalid/hierarchy.flux.json' with { type: 'json' };
import noDocumentExpected from './__fixtures__/invalid/no-document.expected.json' with { type: 'json' };
import noDocument from './__fixtures__/invalid/no-document.flux.json' with { type: 'json' };
import referencesExpected from './__fixtures__/invalid/references.expected.json' with { type: 'json' };
import references from './__fixtures__/invalid/references.flux.json' with { type: 'json' };
import structureExpected from './__fixtures__/invalid/structure.expected.json' with { type: 'json' };
import structure from './__fixtures__/invalid/structure.flux.json' with { type: 'json' };
import versionExpected from './__fixtures__/invalid/version.expected.json' with { type: 'json' };
import version from './__fixtures__/invalid/version.flux.json' with { type: 'json' };
import { DIAGNOSTIC_CODES, jsonPointer } from './diagnostics.js';
import { isValid, validate, validateRecord, validateReferences } from './validate.js';

const summary = (doc: unknown) => validate(doc).map(({ code, severity, path }) => ({ code, severity, path }));

const minimal = {
  schemaVersion: '1.0',
  records: {
    doc: { id: 'doc', type: 'document', title: 'Two rects' },
    s1: { id: 's1', type: 'screen', index: 'a0' },
    a: { id: 'a', type: 'element', screenId: 's1', index: 'a0', kind: 'shape', defId: 'basic:rect', transform: { x: 0, y: 0, w: 100, h: 50 } },
    b: { id: 'b', type: 'element', screenId: 's1', index: 'a1', kind: 'shape', defId: 'basic:rect', transform: { x: 300, y: 0, w: 100, h: 50 } },
    c: { id: 'c', type: 'element', screenId: 's1', index: 'a2', kind: 'connector', route: { type: 'straight' } },
    ba: { id: 'ba', type: 'binding', connectorId: 'c', end: 'source', elementId: 'a', anchor: { kind: 'floating' } },
    bb: { id: 'bb', type: 'binding', connectorId: 'c', end: 'target', elementId: 'b', anchor: { kind: 'side', side: 'w' } },
  },
};

describe('validate', () => {
  it('FR-DOC-004: a valid document has no diagnostics', () => {
    expect(validate(minimal)).toEqual([]);
    expect(isValid(validate(minimal))).toBe(true);
  });

  it('FR-DOC-004: invalid fixtures match their expected diagnostics', () => {
    const cases: [string, unknown, unknown][] = [
      ['references', references, referencesExpected],
      ['structure', structure, structureExpected],
      ['hierarchy', hierarchy, hierarchyExpected],
      ['connectors', connectors, connectorsExpected],
      ['version', version, versionExpected],
      ['no-document', noDocument, noDocumentExpected],
    ];
    for (const [name, doc, expected] of cases) expect(summary(doc), name).toEqual(expected);
  });

  it('FR-DOC-004: reports all errors, not the first only, each with a message', () => {
    const d = validate(structure);
    expect(d.filter((x) => x.severity === 'error').length).toBeGreaterThanOrEqual(6);
    for (const x of d) expect(x.message.length).toBeGreaterThan(0);
    expect(isValid(d)).toBe(false);
  });

  it('gives concrete hints for missing references and enum values', () => {
    const doc = JSON.parse(JSON.stringify(minimal)) as { records: Record<string, Record<string, unknown>> };
    (doc.records['a'] as Record<string, unknown>)['screenId'] = 's9';
    (doc.records['c'] as Record<string, unknown>)['route'] = { type: 'zigzag' };
    const d = validate(doc);
    expect(d.find((x) => x.path === '/records/a/screenId')?.hint).toBe('existing screen ids: s1');
    expect(d.find((x) => x.path === '/records/c/route/type')?.code).toBe('FLX_SCHEMA_INVALID');
    (doc.records['ba'] as Record<string, unknown>)['end'] = 'middle';
    expect(validate(doc).find((x) => x.path === '/records/ba/end')?.hint).toBe('expected one of "source", "target"');
  });

  it('a record failing its schema still counts for existence checks (M2.10 review r2)', () => {
    const doc = JSON.parse(JSON.stringify(minimal));
    doc.records.doc.title = 5;
    doc.records.ba.anchor = { kind: 'bogus' };
    expect(summary(doc).map((x) => `${x.code} ${x.path}`)).toEqual(['FLX_SCHEMA_INVALID /records/ba/anchor/kind', 'FLX_SCHEMA_INVALID /records/doc/title']);
    doc.records.doc2 = { id: 'doc2', type: 'document', title: 7 };
    expect(summary(doc).map((x) => x.code)).toContain('FLX_DOCUMENT_DUPLICATE');
  });

  it('points referential diagnostics at the record key when the id disagrees (M2.10 review F2)', () => {
    const doc = JSON.parse(JSON.stringify(minimal));
    doc.records.a = { ...doc.records.a, id: 'z', screenId: 's9' };
    expect(summary(doc).map((x) => x.path)).toEqual(['/records/a/id', '/records/a/screenId']);
  });

  it('checks the document shell: not an object, version, records, and missing document record', () => {
    expect(summary(42)).toEqual([{ code: 'FLX_DOC_NOT_OBJECT', severity: 'error', path: '' }]);
    expect(summary({ records: {} }).map((x) => x.code)).toEqual(['FLX_VERSION_INVALID', 'FLX_DOCUMENT_MISSING']);
    // a non-canonical spelling of a version is invalid, not the current version
    for (const version of ['1.00', '01.0', '1.01'])
      expect(
        summary({ schemaVersion: version, records: minimal.records }).map((x) => x.code),
        version,
      ).toEqual(['FLX_VERSION_INVALID']);
    expect(summary({ schemaVersion: '0.9', records: minimal.records }).map((x) => x.code)).toEqual(['FLX_VERSION_UNSUPPORTED']);
    expect(summary({ schemaVersion: '1.3', records: minimal.records })).toEqual([{ code: 'FLX_VERSION_NEWER', severity: 'warning', path: '/schemaVersion' }]);
  });

  it('FR-DOC-005: unknown rich-text nodes and marks are warnings with their pointers', () => {
    const doc = JSON.parse(JSON.stringify(minimal)) as { records: Record<string, Record<string, unknown>> };
    doc.records['s1'] = { ...doc.records['s1'], notes: { type: 'doc', content: [{ type: 'callout', content: [] }] } };
    (doc.records['c'] as Record<string, unknown>)['labels'] = [
      { position: 0.5, text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'glow' }] }] }] } },
    ];
    expect(summary(doc)).toEqual([
      { code: 'FLX_TEXT_UNKNOWN_MARK', severity: 'warning', path: '/records/c/labels/0/text/content/0/content/0/marks/0' },
      { code: 'FLX_TEXT_UNKNOWN_NODE', severity: 'warning', path: '/records/s1/notes/content/0' },
    ]);
  });

  it('NFR-REL-005: diagnostics come out in the same order whatever the record order', () => {
    const reversed = { ...structure, records: Object.fromEntries(Object.entries(structure.records).reverse()) };
    expect(validate(reversed)).toEqual(validate(structure));
  });

  it('escapes JSON pointers and documents every code', () => {
    expect(jsonPointer(['records', 'a/b', 'c~d', 0])).toBe('/records/a~1b/c~0d/0');
    expect(Object.keys(DIAGNOSTIC_CODES).every((c) => c.startsWith('FLX_'))).toBe(true);
  });
});

// the two halves of validate() a store runs per transaction (ADR-0014, M3.11)
describe('validateRecord and validateReferences', () => {
  it('FR-DOC-004: validateRecord reports one record structurally, under its key', () => {
    expect(validateRecord('a', minimal.records.a)).toEqual([]);
    const { transform: _t, ...noTransform } = minimal.records.a;
    const missing = validateRecord('a', noTransform);
    expect(missing.map((d) => d.code)).toContain('FLX_SCHEMA_INVALID');
    expect(missing.every((d) => d.path.startsWith('/records/a'))).toBe(true);
    expect(validateRecord('x', minimal.records.a).map((d) => d.code)).toContain('FLX_ID_MISMATCH');
  });

  it('FR-DOC-004: validateReferences equals the referential part of validate', () => {
    const records = new Map(Object.entries(minimal.records)) as unknown as Parameters<typeof validateReferences>[0];
    expect(validateReferences(records)).toEqual([]);
    const { s1: _s, ...noScreen } = minimal.records;
    const without = new Map(Object.entries(noScreen)) as unknown as Parameters<typeof validateReferences>[0];
    expect(validateReferences(without)).toEqual(validate({ schemaVersion: '1.0', records: noScreen }));
    expect(validateReferences(without).map((d) => d.code)).toContain('FLX_REF_MISSING');
  });
});
