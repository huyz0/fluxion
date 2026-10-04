import { type FluxAsset, sha256Hex, writeFlux, writeFluxHtml } from '@fluxion/format';
import { type AnyRecord, type DocumentFile, type RecordId, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { describeFile, fileBytes, kindOf, mayOverwrite, openFileBytes, webHasher } from './file-session.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const text = (s: string) => new TextEncoder().encode(s);
const id = (s: string) => s as RecordId;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);

/** A document with a screen and a rectangle, and an image asset record for PNG used by an image element. */
async function documentWithImage(): Promise<{ document: DocumentFile; hash: string }> {
  const b = documentBuilder({ seed: 90, title: 'Studio file' });
  const screen = b.screen({ name: 'one' });
  b.rect(screen, { x: 10, y: 10, w: 50, h: 50 });
  const doc = b.build();
  const hash = sha256Hex(PNG);
  const records: { [k: string]: AnyRecord } = {
    ...doc.records,
    pic: { id: id('pic'), type: 'asset', hash, mime: 'image/png', size: PNG.length, name: 'p.png' } as AnyRecord,
    img: {
      id: id('img'),
      type: 'element',
      kind: 'image',
      screenId: screen,
      index: 'a7',
      assetId: id('pic'),
      transform: { x: 0, y: 0, w: 5, h: 5 },
    } as AnyRecord,
  };
  return { document: { ...doc, records }, hash };
}
const written = async () => {
  const { document, hash } = await documentWithImage();
  const r = await writeFlux({
    document,
    assets: new Map([[hash, { bytes: PNG, mime: 'image/png' }]]),
    appVersion: '1.0.0',
    source: 'screen one {}',
    manifestExtras: { 'x-future': { keep: true } },
    extraEntries: new Map([['plugins/x@1/player.js', text('export {}')]]),
    hasher,
  });
  if (!r.ok) throw new Error(r.error.reason);
  return { bytes: r.value, document, hash };
};

describe('opening a file in the studio (FR-FIL-006)', () => {
  it('FR-FIL-006: a .flux opens whole, with its assets, source and unknown entries, and may be saved over', async () => {
    const { bytes, hash } = await written();
    expect(kindOf(bytes)).toBe('flux');
    const r = await openFileBytes('deck.flux', bytes, hasher);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ name: 'deck.flux', kind: 'flux', readOnly: false, source: 'screen one {}' });
    expect(r.value.assets.get(hash)?.mime).toBe('image/png');
    expect([...r.value.extraEntries.keys()]).toEqual(['plugins/x@1/player.js']);
    expect(r.value.manifestExtras).toEqual({ 'x-future': { keep: true } });
    expect(mayOverwrite(r.value)).toBe(true);
    expect(describeFile(r.value)).toEqual([]);
  });

  it('FR-FIL-006: a .flux.html opens through its archive without running anything, and is saved as a copy only', async () => {
    const { bytes } = await written();
    const page = await writeFluxHtml({ flux: bytes, playerScript: 'var Fluxion={};', title: 'T', hasher });
    if (!page.ok) throw new Error(page.error.reason);
    expect(kindOf(text(page.value))).toBe('flux.html');
    const r = await openFileBytes('deck.flux.html', text(page.value), hasher);
    expect(r.ok && r.value.kind).toBe('flux.html');
    if (!r.ok) return;
    expect(mayOverwrite(r.value)).toBe(false);
    expect(describeFile(r.value).join(' ')).toContain('Save writes a new .flux');
    // a page with no archive is a line, not a crash
    const bad = await openFileBytes('x.html', text('<!doctype html><meta name="fluxion:format" content="1.0"><p>nothing'), hasher);
    expect(bad.ok ? '' : bad.error).toContain('x.html cannot be opened');
  });

  it('FR-FIL-006: a JSON document that has the HTML marker among its text is still JSON', async () => {
    const { document } = await documentWithImage();
    const withMarker = serializeDocument(document).replace('"title":"Studio file"', '"title":"fluxion:format in a title"');
    expect(kindOf(text(withMarker))).toBe('flux.json');
    const r = await openFileBytes('odd.flux.json', text(withMarker), hasher);
    expect(r.ok && r.value.kind).toBe('flux.json');
    // markup with leading space or a byte-order mark is still a page
    expect(kindOf(text('\ufeff  \n<!doctype html><meta name="fluxion:format" content="1.0">'))).toBe('flux.html');
  });

  it('NFR-PORT-003: a file of a newer major version opens read-only and is never saved over its file', async () => {
    const { document } = await documentWithImage();
    const newer = serializeDocument(document).replace(/"schemaVersion":\s*"[^"]*"/, '"schemaVersion":"9.0"');
    const r = await openFileBytes('future.flux.json', text(newer), hasher);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.readOnly).toBe(true);
    expect(r.value.salvage?.reason).toBe('newer-major');
    expect(mayOverwrite(r.value)).toBe(false);
    expect(describeFile(r.value)[0]).toContain('newer version');
  });

  it('FR-FIL-009: a cut-off document opens in part, says so, and is offered only as a copy', async () => {
    const { document } = await documentWithImage();
    const whole = serializeDocument(document);
    const r = await openFileBytes('cut.flux.json', text(whole.slice(0, Math.floor(whole.length * 0.7))), hasher);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.salvage?.reason).toBe('truncated');
    expect(mayOverwrite(r.value)).toBe(false);
    expect(describeFile(r.value).join(' ')).toContain('cut off');
  });

  it('FR-FIL-009: bytes that are nothing the studio opens are a line naming the file', async () => {
    const r = await openFileBytes('notes.txt', text('hello'), hasher);
    expect(r.ok ? '' : r.error).toContain('notes.txt cannot be opened');
  });
});

describe('saving a file from the studio (NFR-REL-001)', () => {
  it('NFR-REL-001: a re-save keeps the assets, the source, unknown entries and manifest fields of the file it came from', async () => {
    const { bytes, hash } = await written();
    const opened = await openFileBytes('deck.flux', bytes, hasher);
    if (!opened.ok) throw new Error(opened.error);
    const saved = await fileBytes({
      file: opened.value,
      document: opened.value.document,
      bytesOf: () => Promise.resolve(undefined),
      hasher,
      appVersion: '2.0.0',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.missing).toBe(0);
    const again = await openFileBytes('deck.flux', saved.value.bytes, hasher);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.source).toBe('screen one {}');
    expect(again.value.assets.get(hash)?.bytes).toEqual(PNG);
    expect([...again.value.extraEntries.keys()]).toEqual(['plugins/x@1/player.js']);
    expect(again.value.manifestExtras).toEqual({ 'x-future': { keep: true } });
    expect(again.value.document).toEqual(opened.value.document);
  });

  it('NFR-REL-001: an asset added in the editor is written from the bytes the editor holds, one whose bytes do not match its hash is counted missing', async () => {
    const { document, hash } = await documentWithImage();
    const held = new Map<string, FluxAsset>([['pic', { bytes: PNG, mime: 'image/png' }]]);
    const ok = await fileBytes({ file: undefined, document, bytesOf: (assetId) => Promise.resolve(held.get(assetId)), hasher, appVersion: '1.0.0' });
    expect(ok.ok && ok.value.missing).toBe(0);
    const reopened = ok.ok ? await openFileBytes('a.flux', ok.value.bytes, hasher) : undefined;
    expect(reopened?.ok && reopened.value.assets.has(hash)).toBe(true);
    // the editor holds other bytes under that record: they are not that asset
    held.set('pic', { bytes: Uint8Array.from([9, 9, 9]), mime: 'image/png' });
    const wrong = await fileBytes({ file: undefined, document, bytesOf: (assetId) => Promise.resolve(held.get(assetId)), hasher, appVersion: '1.0.0' });
    expect(wrong.ok && wrong.value.missing).toBe(1);
    // no bytes at all
    const none = await fileBytes({ file: undefined, document, bytesOf: () => Promise.resolve(undefined), hasher, appVersion: '1.0.0' });
    expect(none.ok && none.value.missing).toBe(1);
  });

  it('NFR-REL-001: the web hasher agrees with the pure SHA-256', async () => {
    expect(await webHasher.sha256(text('abc'))).toBe(sha256Hex(text('abc')));
  });
});
