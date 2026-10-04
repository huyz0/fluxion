import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { assetRows, formatBytes, unusedAssetIds } from './asset-manager.js';

const id = (s: string) => s as RecordId;
const asset = (name: string, size: number, extra: object = {}): AnyRecord =>
  ({ id: id(name), type: 'asset', hash: name.padEnd(64, '0'), mime: 'image/png', size, name: `${name}.png`, ...extra }) as AnyRecord;

/** A document with a screen, an image element naming `used`, and the assets given. */
const documentOf = (assets: AnyRecord[]): DocumentFile => ({
  schemaVersion: '1.2',
  records: {
    doc: { id: id('doc'), type: 'document', title: 'A' } as AnyRecord,
    screen: { id: id('screen'), type: 'screen', index: 'a0', name: 'S', size: { w: 100, h: 100 }, background: { assetId: id('bg') } } as AnyRecord,
    el: {
      id: id('el'),
      type: 'element',
      kind: 'image',
      screenId: id('screen'),
      index: 'a0',
      assetId: id('used'),
      transform: { x: 0, y: 0, w: 1, h: 1 },
    } as AnyRecord,
    ...Object.fromEntries(assets.map((a) => [a.id, a])),
  },
});

describe('the asset manager model', () => {
  it('FR-AST-005: rows list every asset, the largest first, with size, share of the total and whether anything uses it', () => {
    const rows = assetRows(documentOf([asset('used', 600, { w: 30, h: 20 }), asset('bg', 300), asset('spare', 100)]));
    expect(rows.map((r) => [r.id, r.size, r.used])).toEqual([
      ['used', 600, true],
      ['bg', 300, true],
      ['spare', 100, false],
    ]);
    expect(rows.map((r) => Math.round(r.share * 100))).toEqual([60, 30, 10]);
    expect(rows[0]).toMatchObject({ name: 'used.png', mime: 'image/png', width: 30, height: 20, font: false });
    expect(rows[1]?.width).toBeUndefined();
    expect(unusedAssetIds(rows)).toEqual(['spare']);
  });

  it('FR-AST-005: "Remove unused" is exactly what a save would not write: unused fonts count, a name that only equals an id does not', () => {
    const doc = documentOf([asset('used', 10), asset('spare', 10)]);
    // an element whose NAME is the spare asset's id does not use it
    const records = {
      ...doc.records,
      label: { id: id('label'), type: 'element', kind: 'shape', screenId: id('screen'), index: 'a1', name: 'spare' } as AnyRecord,
    };
    expect(unusedAssetIds(assetRows({ ...doc, records }))).toEqual(['spare']);
    // fonts: with a theme and no text in the family, an uploaded font is unused
    const font = asset('inter', 50, { mime: 'font/woff2', font: { family: 'Inter', weight: 400, style: 'normal' } });
    const themed: DocumentFile = {
      ...doc,
      records: {
        ...doc.records,
        doc: { id: id('doc'), type: 'document', title: 'A', themeId: id('theme') } as AnyRecord,
        theme: { id: id('theme'), type: 'theme', name: 't', tokens: {} } as AnyRecord,
        inter: font,
      },
    };
    const rows = assetRows(themed);
    expect(rows.find((r) => r.id === 'inter')).toMatchObject({ font: true, used: false });
    expect(unusedAssetIds(rows).sort()).toEqual(['inter', 'spare']);
  });

  it('FR-AST-005: an empty document, a record without a size or name, and sizes for people', () => {
    expect(assetRows({ schemaVersion: '1.2', records: {} })).toEqual([]);
    const odd = { id: id('odd'), type: 'asset', hash: 'x'.repeat(64) } as unknown as AnyRecord;
    expect(assetRows(documentOf([odd]))[0]).toMatchObject({ id: 'odd', name: 'odd', size: 0, share: 0, mime: 'application/octet-stream' });
    expect([0, 1023, 1024, 1536, 1024 * 1024, 5.5 * 1024 * 1024].map(formatBytes)).toEqual(['0 B', '1023 B', '1.0 kB', '1.5 kB', '1.0 MB', '5.5 MB']);
  });
});
