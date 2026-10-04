import { type AnyRecord, parseDocument, type RecordId, serializeDocument } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openDocumentText } from './document-open.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FIXTURES = import.meta.glob('../../../fixtures/docs/shapes-gallery.flux.json', { query: '?raw', import: 'default', eager: true });
const galleryText = Object.values(FIXTURES)[0] ?? '';
const gallery = (() => {
  const parsed = parseDocument(galleryText);
  if (!parsed.ok) throw new Error('fixture does not parse');
  return parsed.value.document;
})();
const SCREEN = Object.values(gallery.records).find((r) => r.type === 'screen') as AnyRecord;
const ELEMENTS = Object.values(gallery.records).filter((r) => r.type === 'element');
const DOCUMENT = Object.values(gallery.records).find((r) => r.type === 'document') as AnyRecord;

/** A document text with its records in the given order (JSON keeps insertion order), so a cut falls where the test wants it. */
const ordered = (records: AnyRecord[], schemaVersion = '1.2') => JSON.stringify({ records: Object.fromEntries(records.map((r) => [r.id, r])), schemaVersion });

describe('openDocumentText', () => {
  it('FR-FIL-009: a valid document opens whole, not read-only and not salvaged', () => {
    const r = openDocumentText(galleryText);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ readOnly: false, document: gallery });
    if (r.ok) expect(r.value.salvage).toBeUndefined();
  });

  it('FR-FIL-009: a truncated document.json loads its valid screens and lists the dropped records', () => {
    // the first element and the document come before the cut, the screen the element sits on is cut in half
    const first = ELEMENTS[0] as AnyRecord;
    const whole = ordered([DOCUMENT, first, SCREEN]);
    const cut = whole.slice(0, whole.indexOf(`"${SCREEN.id}":`) + 20);
    const r = openDocumentText(cut);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.salvage).toMatchObject({ reason: 'truncated', recovered: 2, dropped: [first.id] });
    expect(Object.keys(r.value.document.records)).toEqual([DOCUMENT.id]);
    // cut after the screen: the element has its screen and stays, and nothing is dropped
    const later = ordered([DOCUMENT, SCREEN, first]);
    const kept = openDocumentText(later.slice(0, later.length - 30));
    expect(kept.ok && kept.value.salvage).toMatchObject({ reason: 'truncated', recovered: 2, dropped: [] });
    expect(kept.ok && Object.keys(kept.value.document.records)).toEqual([DOCUMENT.id, SCREEN.id]);
  });

  it('FR-FIL-009: a document cut anywhere opens in part or is refused, never throws, and what opens is valid', () => {
    const text = serializeDocument(gallery);
    fc.assert(
      fc.property(fc.nat(text.length), (at) => {
        const r = openDocumentText(text.slice(0, at));
        if (!r.ok) return r.error.code === 'FILE_DOCUMENT_INVALID';
        return parseDocument(serializeDocument(r.value.document)).ok;
      }),
      { numRuns: 150 },
    );
  }, 30_000);

  it('FR-FIL-009: a document with an invalid record opens without it and lists it', () => {
    const broken = { ...(ELEMENTS[0] as AnyRecord), transform: 'not a transform' } as unknown as AnyRecord;
    const r = openDocumentText(ordered([DOCUMENT, SCREEN, broken, ELEMENTS[1] as AnyRecord]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.salvage).toMatchObject({ reason: 'invalid', dropped: [broken.id] });
    expect(r.value.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(Object.keys(r.value.document.records)).toContain((ELEMENTS[1] as AnyRecord).id);
    expect(r.value.readOnly).toBe(false);
  });

  it('NFR-PORT-003: a file of a newer major version opens read-only, with what this version understands', () => {
    const text = ordered([DOCUMENT, SCREEN, ELEMENTS[0] as AnyRecord], '2.0');
    const r = openDocumentText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.readOnly).toBe(true);
    expect(r.value.salvage).toMatchObject({ reason: 'newer-major' });
    expect(Object.keys(r.value.document.records)).toEqual([DOCUMENT.id, SCREEN.id, (ELEMENTS[0] as AnyRecord).id]);
    // a record the newer version added that does not validate is dropped and listed, the rest still opens
    const unknown = { id: 'ZZZZZZZZZZZZZZZZ' as RecordId, type: 'element', kind: 'shape', screenId: 'missing-screen-id' } as unknown as AnyRecord;
    const partial = openDocumentText(ordered([DOCUMENT, SCREEN, unknown], '3.1'));
    expect(partial.ok && partial.value.salvage).toMatchObject({ reason: 'newer-major', dropped: ['ZZZZZZZZZZZZZZZZ'] });
    // an id that is an inherited property name is still listed when it is dropped
    const inherited = { ...(ELEMENTS[0] as AnyRecord), id: 'constructor' as RecordId, transform: 'bad' } as unknown as AnyRecord;
    const proto = openDocumentText(ordered([DOCUMENT, SCREEN, inherited]));
    expect(proto.ok && proto.value.salvage?.dropped).toEqual(['constructor']);
    // a newer minor is not a newer major: it opens whole
    const minor = openDocumentText(ordered([DOCUMENT, SCREEN], '1.9'));
    expect(minor.ok && minor.value.readOnly).toBe(false);
  });

  it("FR-FIL-009: a cut file that lost its schemaVersion takes the manifest's, and with none it is read as the current one and opens read-only", () => {
    const whole = ordered([DOCUMENT, SCREEN, ELEMENTS[0] as AnyRecord]);
    // the canonical writer puts schemaVersion after the records: a cut inside the last record has none
    const cut = whole.slice(0, whole.lastIndexOf(`"${(ELEMENTS[0] as AnyRecord).id}"`) + 15);
    const guessed = openDocumentText(cut);
    expect(guessed.ok && guessed.value).toMatchObject({ readOnly: true, salvage: { reason: 'truncated', versionGuessed: true, recovered: 2 } });
    const hinted = openDocumentText(cut, '1.2');
    expect(hinted.ok && hinted.value.readOnly).toBe(false);
    expect(hinted.ok && hinted.value.salvage?.versionGuessed).toBeUndefined();
    // the manifest says a newer major: the cut file opens read-only as an uncut one would
    const newer = openDocumentText(cut, '2.0');
    expect(newer.ok && newer.value).toMatchObject({ readOnly: true, salvage: { reason: 'truncated' } });
    // the text names the newer major itself, before the records
    const named = JSON.stringify({ schemaVersion: '2.0', records: { [DOCUMENT.id]: DOCUMENT, [SCREEN.id]: SCREEN } });
    const namedCut = openDocumentText(named.slice(0, named.length - 40));
    expect(namedCut.ok && namedCut.value).toMatchObject({ readOnly: true, salvage: { reason: 'truncated' } });
    // an older version named by the manifest is migrated, not read as current
    const old = openDocumentText(cut, '1.0');
    expect(old.ok).toBe(true);
  });

  it('FR-FIL-009: text with nothing to recover is refused with a message', () => {
    for (const text of [
      '',
      'not json at all',
      '{"records":{',
      '{"records":{"a":{"id":"a","type":"screen"',
      '[]',
      '"x"',
      '{"schemaVersion":"2.0"}',
      ordered([], '2.0'),
    ]) {
      const r = openDocumentText(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('FILE_DOCUMENT_INVALID');
    }
  });
});
