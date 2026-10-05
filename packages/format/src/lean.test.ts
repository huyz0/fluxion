import { parseDocument } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openDocumentText } from './document-open.js';
import { writeFlux } from './flux-writer.js';
import { leanDocumentText, loadFluxLean } from './lean.js';
import { loadFlux } from './loader.js';
import { sha256Hex as sha256 } from './sha256.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// every document fixture of the current schema (the invalid ones are the validating loader's, not the lean reader's)
const FIXTURES = import.meta.glob('../../../fixtures/docs/*.flux.json', { query: '?raw', import: 'default', eager: true });
const CURRENT = Object.entries(FIXTURES).filter(([path]) => !/invalid-|unknown-kind/.test(path));
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };

describe('the lean reader (ADR-0026, NFR-SEC-001, NFR-REL-002)', () => {
  it('NFR-SEC-001: the lean reader and the validating loader give the same document on every current-schema fixture', () => {
    expect(CURRENT.length).toBeGreaterThanOrEqual(6);
    for (const [path, text] of CURRENT) {
      const lean = leanDocumentText(text);
      const full = openDocumentText(text);
      expect(lean.ok && full.ok, path).toBe(true);
      if (!lean.ok || !full.ok) continue;
      expect(lean.value.document, path).toEqual(full.value.document);
      expect(lean.value.readOnly, path).toBe(false);
      expect(lean.value.salvage, path).toBeUndefined();
    }
  });

  it('NFR-SEC-001: a file written by the writer opens the same through the lean loader and the validating one, assets and notes included', async () => {
    const [, text] = CURRENT.find(([path]) => path.endsWith('two-rects-line.flux.json')) ?? ['', ''];
    const parsed = parseDocument(text);
    if (!parsed.ok) throw new Error('fixture');
    const zip = await writeFlux({ document: parsed.value.document, appVersion: '0', hasher });
    if (!zip.ok) throw new Error(zip.error.reason);
    const [lean, full] = [await loadFluxLean(zip.value, { hasher }), await loadFlux(zip.value, { hasher })];
    expect(lean.ok && full.ok).toBe(true);
    if (!lean.ok || !full.ok) return;
    expect(lean.value.document).toEqual(full.value.document);
    expect(lean.value.notes).toEqual(full.value.notes);
    expect([...lean.value.assets.keys()]).toEqual([...full.value.assets.keys()]);
  });

  it('FR-FIL-009: another schema version, text that is not JSON and a document with no readable record are refused with a message that sends the file to the studio', () => {
    const records = '{"AAAAAAAAAAAAAAAA":{"id":"AAAAAAAAAAAAAAAA","type":"document"}}';
    for (const text of [
      `{"schemaVersion":"1.1","records":${records}}`,
      `{"schemaVersion":"2.0","records":${records}}`,
      `{"records":${records}}`,
      '{"schemaVersion":"1.2","records":{',
      'not json',
      '[]',
      '{"schemaVersion":"1.2","records":[]}',
      '{"schemaVersion":"1.2","records":{"a":{"id":"b","type":"document"}}}',
    ]) {
      const r = leanDocumentText(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('FILE_DOCUMENT_INVALID');
        expect(r.error.message).toContain('studio');
      }
    }
  });

  it('NFR-SEC-001: a record that is not well formed is left out and listed, the rest is shown, and the document is not saved over', () => {
    const good = '"AAAAAAAAAAAAAAAA":{"id":"AAAAAAAAAAAAAAAA","type":"document"}';
    const text = `{"schemaVersion":"1.2","records":{${good},"x":{"id":"y","type":"screen","index":"a0"},"s":{"id":"s","type":"screen"},"u":{"id":"u","type":"nope"},"n":5,"e":{"id":"e","type":"element","index":"a0","screenId":"s"}}}`;
    const r = leanDocumentText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value.document.records)).toEqual(['AAAAAAAAAAAAAAAA']);
    expect(r.value.readOnly).toBe(true);
    expect(r.value.salvage).toEqual({ reason: 'invalid', dropped: ['x', 's', 'u', 'n', 'e'] });
  });

  it('NFR-SEC-001: a record keyed __proto__ or constructor is an own record like any other, never the prototype of the records', () => {
    const rec = (id: string, extra = '') => `"${id}":{"id":"${id}","type":"screen","index":"a0"${extra}}`;
    const text = `{"schemaVersion":"1.2","records":{"AAAAAAAAAAAAAAAA":{"id":"AAAAAAAAAAAAAAAA","type":"document"},${rec('__proto__', ',"name":"evil"')},${rec('constructor')}}}`;
    const r = leanDocumentText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const records = r.value.document.records;
    expect(Object.keys(records)).toEqual(['AAAAAAAAAAAAAAAA', '__proto__', 'constructor']);
    expect(Object.getPrototypeOf(records)).toBe(Object.prototype);
    expect(Object.hasOwn(records, '__proto__')).toBe(true);
    expect((records as { [id: string]: unknown })['toString']).toBe(Object.prototype.toString);
  });

  it('NFR-REL-002: the lean reader never throws on corrupted input', async () => {
    const [, text] = CURRENT.find(([path]) => path.endsWith('minimal.flux.json')) ?? ['', ''];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: text.length }),
        fc.integer({ min: 0, max: text.length }),
        fc.string({ maxLength: 8 }),
        async (cut, at, junk) => {
          // truncated text, text with a splice of junk, and arbitrary strings: a result, never a throw
          for (const t of [text.slice(0, cut), text.slice(0, at) + junk + text.slice(at), junk]) {
            const r = leanDocumentText(t);
            expect(typeof r.ok).toBe('boolean');
          }
        },
      ),
    );
    // and whole archives with bytes flipped or cut
    const parsed = parseDocument(text);
    if (!parsed.ok) throw new Error('fixture');
    const zip = await writeFlux({ document: parsed.value.document, appVersion: '0', hasher });
    if (!zip.ok) throw new Error(zip.error.reason);
    const bytes = zip.value;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: bytes.length }),
        fc.integer({ min: 0, max: bytes.length - 1 }),
        fc.integer({ min: 0, max: 255 }),
        async (cut, at, value) => {
          const flipped = Uint8Array.from(bytes);
          flipped[at] = value;
          for (const b of [bytes.slice(0, cut), flipped]) {
            const r = await loadFluxLean(b, { hasher });
            expect(typeof r.ok).toBe('boolean');
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
