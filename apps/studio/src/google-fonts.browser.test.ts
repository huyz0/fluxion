import { createCore } from '@fluxion/core';
import { createAssetStore } from '@fluxion/editor';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { addGoogleFont, type CatalogFamily, cssUrl, type Fetch, fetchGoogleFont, loadCatalog, parseSlices, readCatalog } from './google-fonts.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const ROBOTO = import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true });

const FAMILY: CatalogFamily = {
  family: 'Fx Google',
  id: 'fx-google',
  category: 'sans-serif',
  weights: [400, 700],
  styles: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext'],
  license: 'OFL-1.1',
  copyright: 'Copyright 2020 The Fx Google Project Authors',
};
const LATIN = 'U+0000-00FF,U+0131';
const EXT = 'U+0100-02BA';
const file = (name: string) => `https://fonts.gstatic.com/s/fxgoogle/v1/${name}.woff2`;
const block = (subset: string, weight: number, range: string, url: string) =>
  `/* ${subset} */\n@font-face {\n  font-family: 'Fx Google';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(${url}) format('woff2');\n  unicode-range: ${range};\n}\n`;
const SHEET = block('latin-ext', 400, EXT, file('ext400')) + block('latin', 400, LATIN, file('latin400'));

/** A fetch answering the stylesheet and the files like Google does, and recording what was asked. */
function mock(sheet: string, bytes: Uint8Array, over: { status?: number } = {}) {
  const asked: { url: string; agent: string | undefined }[] = [];
  const http: Fetch = async (url, init) => {
    asked.push({ url, agent: init?.headers?.['User-Agent'] });
    const status = url.startsWith('https://fonts.googleapis.com/') ? (over.status ?? 200) : 200;
    return { ok: status === 200, status, text: async () => sheet, arrayBuffer: async () => bytes.slice().buffer };
  };
  return { http, asked };
}
const roboto = async () => new Uint8Array(await (await fetch(Object.values(ROBOTO)[0] as string)).arrayBuffer());

function deps() {
  const b = documentBuilder({ seed: 3 });
  b.screen();
  const core = createCore(b.build());
  let n = 0;
  return { core, deps: { execute: core.execute, assets: createAssetStore(), newId: () => `GoogleAsset${String(++n).padStart(6, '0')}` as never } };
}

describe('Google Fonts in the studio (FR-THM-008, ADR-0022)', () => {
  it('FR-THM-008: the stylesheet request names the family, the weights and styles, and Google answers slices that are parsed', () => {
    expect(cssUrl('Fx Google', [700, 400], ['normal', 'italic'])).toBe(
      'https://fonts.googleapis.com/css2?family=Fx+Google:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    );
    expect(parseSlices(SHEET)).toEqual([
      { family: 'Fx Google', weight: 400, style: 'normal', subset: 'latin-ext', unicodeRange: EXT, url: file('ext400') },
      { family: 'Fx Google', weight: 400, style: 'normal', subset: 'latin', unicodeRange: LATIN, url: file('latin400') },
    ]);
    expect(parseSlices('not css')).toEqual([]);
  });

  it('FR-THM-008: a fetch asks Google with a woff2 user agent, takes the Latin slice by default and refuses what is not at fonts.gstatic.com', async () => {
    const { http, asked } = mock(SHEET, await roboto());
    const r = await fetchGoogleFont(http, FAMILY, { weights: [400], styles: ['normal'] });
    expect(r.ok && r.value.map((s) => [s.subset, s.url])).toEqual([['latin', file('latin400')]]);
    expect(asked[0]?.agent).toMatch(/Chrome/);
    expect(asked.map((a) => a.url)).toEqual([cssUrl('Fx Google', [400], ['normal']), file('latin400')]);
    const elsewhere = await fetchGoogleFont(mock(block('latin', 400, LATIN, 'https://evil.example/f.woff2'), new Uint8Array()).http, FAMILY, {
      weights: [400],
      styles: ['normal'],
    });
    expect(!elsewhere.ok && elsewhere.error.code).toBe('GOOGLE_URL');
    const code = async (http: Fetch, weights: number[]) => {
      const x = await fetchGoogleFont(http, FAMILY, { weights, styles: ['normal'] });
      return x.ok ? 'ok' : x.error.code;
    };
    expect(await code(mock(SHEET, new Uint8Array(), { status: 500 }).http, [400])).toBe('GOOGLE_FETCH');
    // a family with no Latin subset starts from its first subset instead of finding nothing
    const cyrillic = { ...FAMILY, subsets: ['cyrillic'] };
    const sheetCyrillic = block('cyrillic', 400, 'U+0400-045F', file('cyr400'));
    const fromFirst = await fetchGoogleFont(mock(sheetCyrillic, await roboto()).http, cyrillic, { weights: [400], styles: ['normal'] });
    expect(fromFirst.ok && fromFirst.value.map((s) => s.subset)).toEqual(['cyrillic']);
    // an answer far larger than any real one is refused rather than read on
    expect(await code(mock(`${SHEET}${' '.repeat(250_000)}`, new Uint8Array()).http, [400])).toBe('GOOGLE_PARSE');
    expect(await code(() => Promise.reject(new Error('offline')), [400])).toBe('GOOGLE_FETCH');
    expect(await code(mock('', new Uint8Array()).http, [400])).toBe('GOOGLE_PARSE');
    expect(await code(mock(SHEET, new Uint8Array()).http, [300])).toBe('GOOGLE_REQUEST');
  });

  it('FR-THM-008: a fetched Google font gets a metrics record', async () => {
    const { core, deps: d } = deps();
    const { http } = mock(SHEET, await roboto());
    const added = await addGoogleFont(d, http, FAMILY, { weights: [400], styles: ['normal'] });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value).toHaveLength(1);
    const asset = core.store.get(added.value[0] as never) as unknown as {
      mime: string;
      font: {
        family: string;
        source: string;
        license: string;
        copyright: string;
        unicodeRange: string;
        metrics: { unitsPerEm: number; advances: { [c: string]: number } };
      };
    };
    expect(asset.mime).toBe('font/woff2');
    expect(asset.font).toMatchObject({ family: 'Fx Google', source: 'google', license: 'OFL-1.1', copyright: FAMILY.copyright, unicodeRange: LATIN });
    expect(asset.font.metrics.unitsPerEm).toBe(1000);
    expect(asset.font.metrics.advances['H']).toBeGreaterThan(300);
    expect([...document.fonts].some((f) => f.family.replaceAll('"', '') === 'Fx Google' && f.status === 'loaded')).toBe(true);
  }, 60_000);

  it('FR-THM-008: more subsets are stored as slices with their ranges; a failure stops the rest', async () => {
    const { core, deps: d } = deps();
    const both = await addGoogleFont(d, mock(SHEET, await roboto()).http, FAMILY, { weights: [400], styles: ['normal'], subsets: ['latin', 'latin-ext'] });
    expect(both.ok && both.value.length).toBe(2);
    const ranges = core.store.members('byType', 'asset').map((id) => (core.store.get(id) as unknown as { font: { unicodeRange: string } }).font.unicodeRange);
    expect(new Set(ranges)).toEqual(new Set([LATIN, EXT]));
    // bytes that are not a font: the diagnostic of the upload path, nothing more added
    const bad = await addGoogleFont(deps().deps, mock(SHEET, Uint8Array.from([1, 2, 3, 4])).http, FAMILY, { weights: [400], styles: ['normal'] });
    expect(bad.ok ? 'ok' : bad.error.code).toBe('FONT_FORMAT');
    const refused = await addGoogleFont(d, mock(SHEET, new Uint8Array()).http, FAMILY, { weights: [300], styles: ['normal'] });
    expect(refused.ok ? 'ok' : refused.error.code).toBe('GOOGLE_REQUEST');
  }, 120_000);

  it('FR-THM-008: the catalog lists the OFL and Apache families of the pack, and leaves out an entry that is not well formed', async () => {
    const families = await loadCatalog();
    expect(families.length).toBeGreaterThan(1000);
    expect(families.find((f) => f.family === 'Inter')).toMatchObject({ license: 'OFL-1.1', weights: expect.arrayContaining([400, 700]) });
    expect(new Set(families.map((f) => f.license))).toEqual(new Set(['OFL-1.1', 'Apache-2.0']));
    expect(readCatalog({ families: [{ family: 'X' }, null, { ...FAMILY }, 'junk'] }).map((f) => f.family)).toEqual(['Fx Google']);
    expect(readCatalog(undefined)).toEqual([]);
    expect(readCatalog({ families: 'no' })).toEqual([]);
    // a catalog that cannot be fetched is an error (the picker shows it), not an empty list
    await expect(loadCatalog(async () => ({ ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }))).rejects.toThrow(
      '404',
    );
  });
});
