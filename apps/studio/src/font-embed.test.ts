import { loadFlux, sha256Hex } from '@fluxion/format';
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { fileBytes } from './file-session.js';
import { type BundledFace, bundledFontsFor } from './font-embed.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const FAMILIES = ['Inter', 'Source Serif 4', 'JetBrains Mono'];
/** Four faces a family, each file its own bytes; `missing` names a family whose file the build lacks. */
const faces = (missing?: string): BundledFace[] =>
  FAMILIES.flatMap((family) =>
    ([400, 700] as const).flatMap((weight) =>
      (['normal', 'italic'] as const).map((style) => ({
        family,
        weight,
        style,
        license: 'OFL-1.1',
        copyright: `Copyright ${family}`,
        name: `${family}-${weight}-${style}.woff2`,
        metrics: { family, weight, style, unitsPerEm: 1000, advances: {}, defaultAdvance: 500, pairs: {}, triples: {} },
        bytes: () => Promise.resolve(family === missing ? undefined : new TextEncoder().encode(`${family}/${weight}/${style}`)),
      })),
    ),
  );
let counter = 0;
const deps = (missing?: string) => ({ faces: faces(missing), newId: () => `font${++counter}` as RecordId, sha256: hasher.sha256 });

/** A one-screen document; `family` sets the font of one rectangle's style. */
function doc(family?: string): DocumentFile {
  const b = documentBuilder({ seed: 480, title: 'Fonts' });
  const screen = b.screen({ name: 'one' });
  const rect = b.rect(screen, { x: 10, y: 10, w: 80, h: 40, label: 'Text' });
  const d = b.build();
  if (family === undefined) return d;
  const record = d.records[rect] as unknown as { style?: object };
  return { ...d, records: { ...d.records, [rect]: { ...record, style: { ...record.style, font: { family } } } as unknown as AnyRecord } };
}
/** The font metadata of an asset record. */
const fontOf = (r: object): { family: string; weight: number; style: string } => (r as { font: { family: string; weight: number; style: string } }).font;
const familiesOf = (records: readonly object[]) => [...new Set(records.map((r) => fontOf(r).family))].sort();

describe('embedding the bundled fonts on save (FR-THM-008, NFR-SIZE-004, NFR-LIC-003)', () => {
  it("NFR-SIZE-004: a document with no theme record draws in the built-in theme's Inter, so Inter's four faces are embedded and no other family", async () => {
    const { records, assets } = await bundledFontsFor(doc(), deps());
    expect(familiesOf(records)).toEqual(['Inter']);
    expect(records).toHaveLength(4);
    expect(assets.size).toBe(4);
  });

  it('NFR-SIZE-004: a family the text names is embedded as well, and one nothing names is not', async () => {
    const { records } = await bundledFontsFor(doc('Source Serif 4'), deps());
    expect(familiesOf(records)).toEqual(['Inter', 'Source Serif 4']);
  });

  it('NFR-LIC-003: each embedded face carries its copyright line, licence and recorded metrics, and the hash of its file', async () => {
    const { records, assets } = await bundledFontsFor(doc(), deps());
    const face = records.find((r) => fontOf(r).weight === 700 && fontOf(r).style === 'italic');
    expect(face).toMatchObject({
      type: 'asset',
      mime: 'font/woff2',
      name: 'Inter-700-italic.woff2',
      font: { family: 'Inter', source: 'bundled', license: 'OFL-1.1', copyright: 'Copyright Inter', metrics: { weight: 700, style: 'italic' } },
    });
    expect(assets.get(face?.hash ?? '')?.bytes).toEqual(new TextEncoder().encode('Inter/700/italic'));
  });

  it('NFR-SIZE-004: a family the document already embeds is not added again, and a face the build lacks is left out', async () => {
    const d = doc();
    const embedded = {
      id: 'up1' as RecordId,
      type: 'asset',
      hash: 'a'.repeat(64),
      mime: 'font/woff2',
      size: 1,
      name: 'inter.woff2',
      font: { family: 'inter', weight: 400, style: 'normal' },
    } as unknown as AnyRecord;
    const withUpload = { ...d, records: { ...d.records, up1: embedded } };
    expect((await bundledFontsFor(withUpload, deps())).records).toHaveLength(0);
    expect((await bundledFontsFor(doc('JetBrains Mono'), deps('JetBrains Mono'))).records.map((r) => fontOf(r).family)).not.toContain('JetBrains Mono');
  });

  it('FR-THM-008: a saved file holds the fonts with their bytes, the open document is unchanged, and the file loads', async () => {
    const d = doc();
    const before = Object.keys(d.records).length;
    const saved = await fileBytes({
      file: undefined,
      document: d,
      bytesOf: () => Promise.resolve(undefined),
      hasher,
      appVersion: '0',
      fonts: (document) => bundledFontsFor(document, deps()),
    });
    expect(saved.ok).toBe(true);
    expect(Object.keys(d.records)).toHaveLength(before);
    const loaded = await loadFlux(saved.ok ? saved.value.bytes : new Uint8Array(), { hasher });
    if (!loaded.ok) throw new Error('the saved file does not load');
    const fonts = Object.values(loaded.value.document.records).filter((r) => r.type === 'asset');
    expect(fonts).toHaveLength(4);
    expect(loaded.value.assets.size).toBe(4);
    expect(saved.ok && saved.value.missing).toBe(0);
  });
});
