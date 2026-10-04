import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { createMemoryAssetStore, referencedAssetHashes, selectAssets } from './asset-store.js';
import { writeFlux } from './flux-writer.js';
import { loadFlux } from './loader.js';
import { sha256Hex } from './sha256.js';
import { usedFontFamilies } from './used-fonts.js';
import { encodeUtf8 } from './utf8.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const id = (s: string) => s as RecordId;
const hashOf = (name: string) => sha256Hex(encodeUtf8(`font-bytes-${name}`));

/** A font asset record of `family` (and weight) with the attribution a saved font must carry. */
const font = (name: string, family: string, weight = 400): AnyRecord =>
  ({
    id: id(name),
    type: 'asset',
    hash: hashOf(name),
    mime: 'font/woff2',
    size: 20,
    name: `${name}.woff2`,
    font: { family, weight, style: 'normal', source: 'upload', license: 'OFL-1.1', copyright: `Copyright 2024 The ${family} Project Authors` },
  }) as AnyRecord;

const tokens = {
  font: {
    heading: { $type: 'fontFamily', $value: ['Inter', 'system-ui'] },
    body: { $type: 'fontFamily', $value: '{font.heading}' },
    mono: { $type: 'fontFamily', $value: ['JetBrains Mono', 'monospace'] },
  },
};

/** A document with a theme, the given element records, and the five fonts Inter (two weights), JetBrains Mono, Pacifico and Lobster. */
function documentOf(elements: { [id: string]: object }, theme: object = { tokens }): DocumentFile {
  const records: { [k: string]: AnyRecord } = {
    doc: { id: id('doc'), type: 'document', title: 'Fonts', themeId: id('theme') } as AnyRecord,
    theme: { id: id('theme'), type: 'theme', name: 't', ...theme } as AnyRecord,
    screen: { id: id('screen'), type: 'screen', index: 'a0', name: 'S', size: { w: 1920, h: 1080 } } as AnyRecord,
    interRegular: font('interRegular', 'Inter'),
    interBold: font('interBold', 'Inter', 700),
    mono: font('mono', 'JetBrains Mono'),
    pacifico: font('pacifico', 'Pacifico'),
    lobster: font('lobster', 'Lobster'),
  };
  for (const [key, fields] of Object.entries(elements)) {
    records[key] = { id: id(key), type: 'element', kind: 'shape', screenId: id('screen'), index: 'a0', ...fields } as AnyRecord;
  }
  return { schemaVersion: '1.2', records };
}
/** The screen record of a test document. */
const screenOf = (doc: DocumentFile): AnyRecord => doc.records[id('screen')] as AnyRecord;
const embedded = (doc: DocumentFile) => referencedAssetHashes(doc);
const hashes = (...names: string[]) => names.map(hashOf).sort();

describe('the fonts a document uses', () => {
  it('FR-THM-008: only the families the text names are embedded, every face of a used family', () => {
    const doc = documentOf({
      a: { style: { font: { family: 'Pacifico' } } },
      b: { style: { font: { family: '"JetBrains Mono", monospace' } } },
    });
    expect([...(usedFontFamilies(doc) ?? [])].sort()).toEqual(['jetbrains mono', 'monospace', 'pacifico']);
    expect(embedded(doc)).toEqual(hashes('mono', 'pacifico'));
  });

  it('FR-THM-008: a token reference is followed to the families it stands for, through an alias', () => {
    // {font.body} is an alias of {font.heading}, which lists Inter: both Inter faces are used, Lobster and Pacifico are not
    const doc = documentOf({ a: { style: { font: { family: '{font.body}' } } } });
    expect(embedded(doc)).toEqual(hashes('interRegular', 'interBold'));
  });

  it('FR-THM-008: rich text font marks count, at any depth', () => {
    const doc = documentOf({
      a: {
        text: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'hi',
                  marks: [
                    { type: 'font', attrs: { family: 'Lobster' } },
                    { type: 'font', attrs: { family: '{font.mono}' } },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(embedded(doc)).toEqual(hashes('lobster', 'mono'));
  });

  it('FR-THM-008: the theme defaults apply to every element that sets nothing, so their font is used', () => {
    const theme = { tokens, defaults: { shape: { font: { family: '{font.body}' } } } };
    const doc = documentOf({ a: {} }, theme);
    expect(embedded(doc)).toEqual(hashes('interRegular', 'interBold'));
  });

  it('FR-THM-008: with no theme record the defaults cannot be read, so every font is kept', () => {
    const doc = documentOf({ a: { style: { font: { family: 'Pacifico' } } } });
    const records = { ...doc.records, doc: { id: id('doc'), type: 'document', title: 'Fonts' } as AnyRecord };
    expect(usedFontFamilies({ ...doc, records })).toBeUndefined();
    expect(embedded({ ...doc, records })).toEqual(hashes('interRegular', 'interBold', 'mono', 'pacifico', 'lobster'));
  });

  it('FR-THM-004: a screen theme override is read too: its defaults and its own tokens', () => {
    // the screen names a second theme whose body font is Lobster and whose defaults use Pacifico; the document's theme uses Inter
    const second = {
      id: id('theme2'),
      type: 'theme',
      name: 'u',
      tokens: { font: { body: { $type: 'fontFamily', $value: ['Lobster'] } } },
      defaults: { shape: { font: { family: 'Pacifico' } } },
    };
    const doc = documentOf({ a: { style: { font: { family: '{font.body}' } } } });
    const records = {
      ...doc.records,
      theme2: second as unknown as AnyRecord,
      screen: { ...screenOf(doc), themeId: id('theme2') } as AnyRecord,
    };
    expect(embedded({ ...doc, records })).toEqual(hashes('interRegular', 'interBold', 'lobster', 'pacifico'));
    // the same document without the override does not use them
    expect(embedded(doc)).toEqual(hashes('interRegular', 'interBold'));
    // a screen naming a record that is no theme (or nothing) adds nothing and is not an error
    const odd = { ...doc, records: { ...doc.records, screen: { ...screenOf(doc), themeId: id('mono') } as AnyRecord } };
    expect(embedded(odd)).toEqual(hashes('interRegular', 'interBold'));
  });

  it('FR-THM-008: families match without regard to case, quotes or runs of spaces; an alias chain longer than the hop cap resolves to nothing', () => {
    const doc = documentOf({ a: { style: { font: { family: "  'jetbrains   MONO' " } } } });
    expect(embedded(doc)).toEqual(hashes('mono'));
    const chain: { [k: string]: object } = { n0: { $type: 'fontFamily', $value: ['Lobster'] } };
    for (let i = 1; i <= 12; i++) chain[`n${i}`] = { $type: 'fontFamily', $value: `{font.n${i - 1}}` };
    const long = documentOf({ a: { style: { font: { family: '{font.n12}' } } } }, { tokens: { font: chain } });
    expect(embedded(long)).toEqual([]);
    const short = documentOf({ a: { style: { font: { family: '{font.n5}' } } } }, { tokens: { font: chain } });
    expect(embedded(short)).toEqual(hashes('lobster'));
  });

  it('NFR-REL-002: a reference loop, a reference to nothing and a deeply nested record end quickly and use nothing', () => {
    const looping = { font: { a: { $type: 'fontFamily', $value: '{font.b}' }, b: { $type: 'fontFamily', $value: '{font.a}' } } };
    let nested: object = { font: { family: 'Lobster' } };
    for (let i = 0; i < 500; i++) nested = { child: nested };
    const doc = documentOf(
      {
        a: { style: { font: { family: '{font.a}' } } },
        b: { style: { font: { family: '{font.nothing}' } } },
        c: nested,
        d: { style: { font: { family: 7 } } },
      },
      { tokens: looping },
    );
    expect(embedded(doc)).toEqual([]);
  });

  it('NFR-LIC-003: a saved font carries its copyright line and licence in the file, and an unused font is not in it', async () => {
    const doc = documentOf({ a: { style: { font: { family: 'Pacifico' } } } });
    const store = createMemoryAssetStore(hasher);
    for (const name of ['interRegular', 'interBold', 'mono', 'pacifico', 'lobster']) await store.put(encodeUtf8(`font-bytes-${name}`), 'font/woff2');
    const picked = await selectAssets(doc, store);
    expect([...picked.assets.keys()]).toEqual(hashes('pacifico'));
    const zip = await writeFlux({ document: doc, assets: picked.assets, appVersion: '1.0.0', hasher });
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    const loaded = await loadFlux(zip.value, { hasher });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect([...loaded.value.assets.keys()]).toEqual(hashes('pacifico'));
    // the record that travels with the bytes names the licence and the copyright line
    const record = loaded.value.document.records[id('pacifico')] as unknown as { font: { license: string; copyright: string } };
    expect(record.font.license).toBe('OFL-1.1');
    expect(record.font.copyright).toBe('Copyright 2024 The Pacifico Project Authors');
  });
});
