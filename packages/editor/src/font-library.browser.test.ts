import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { createAssetStore } from './asset-store.js';
import { addFont } from './font-library.js';
import { newDocument } from './new-document.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const FONTS = import.meta.glob('../../../fixtures/fonts/roboto-700.woff2', { query: '?url', import: 'default', eager: true });
const bytes = async () => new Uint8Array(await (await fetch(Object.values(FONTS)[0] as string)).arrayBuffer());

function setup() {
  const core = createCore(newDocument(seededRandom(7)));
  const assets = createAssetStore();
  let n = 0;
  const newId = () => `FontAsset${String(++n).padStart(7, '0')}` as never;
  return { core, assets, deps: { execute: core.execute, assets, newId } };
}

describe('adding a font to the document (FR-THM-008, ADR-0022)', () => {
  it('FR-THM-008: bytes that are not a font are rejected with a diagnostic, and the document is unchanged', async () => {
    const { core, deps } = setup();
    const before = core.store.toDocument();
    for (const [name, data, code] of [
      ['photo.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), 'FONT_FORMAT'],
      ['fonts.ttc', Uint8Array.from([0x74, 0x74, 0x63, 0x66, 0, 0, 0, 0]), 'FONT_FORMAT'],
      ['broken.woff2', Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]), 'FONT_CORRUPT'],
    ] as const) {
      const r = await addFont(deps, { bytes: data, name, source: 'upload' });
      expect(r.ok ? 'ok' : r.error.code, name).toBe(code);
    }
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-THM-008: an uploaded font gets a metrics record, its bytes are held, its face is loaded and measured, in one undo step', async () => {
    const { core, assets, deps } = setup();
    const added = await addFont(deps, {
      bytes: await bytes(),
      name: 'Roboto-Bold.woff2',
      source: 'upload',
      family: 'Fx Upload Roboto',
      weight: 700,
      license: 'OFL-1.1',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const asset = core.store.get(added.value) as unknown as {
      mime: string;
      name: string;
      hash: string;
      font: {
        family: string;
        weight: number;
        style: string;
        source: string;
        license: string;
        metrics: { family: string; unitsPerEm: number; advances: { [c: string]: number } };
      };
    };
    expect(asset).toMatchObject({
      type: 'asset',
      mime: 'font/woff2',
      name: 'Roboto-Bold.woff2',
      font: { family: 'Fx Upload Roboto', weight: 700, style: 'normal', source: 'upload', license: 'OFL-1.1' },
    });
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/);
    // the record carries the recorded metrics, named as the document names the face
    expect(asset.font.metrics).toMatchObject({ family: 'Fx Upload Roboto', unitsPerEm: 1000 });
    expect(asset.font.metrics.advances['H']).toBeGreaterThan(300);
    expect(assets.url(added.value)).toMatch(/^data:font\/woff2;base64,/);
    // the page draws with the face now
    expect([...document.fonts].some((f) => f.family.replaceAll('"', '') === 'Fx Upload Roboto' && f.status === 'loaded')).toBe(true);
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect(core.store.has(added.value)).toBe(false);
  }, 60_000);

  it('FR-THM-008: family, weight and style fall back to the file name and the defaults when the file names none', async () => {
    const { core, deps } = setup();
    const added = await addFont(deps, { bytes: await bytes(), name: 'Fx_Display-Bold.woff2', source: 'upload' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect((core.store.get(added.value) as unknown as { font: { family: string; weight: number; license: string } }).font).toMatchObject({
      family: 'Fx Display',
      weight: 400,
      license: 'unknown',
    });
    const plain = await addFont(deps, { bytes: await bytes(), name: '.woff2', source: 'upload' });
    expect(plain.ok && (core.store.get(plain.value) as unknown as { font: { family: string } }).font.family).toBe('Uploaded font');
  }, 60_000);

  it('FR-THM-008: a weight or family the caller gets wrong is named, not blamed on the file; a document that refuses the asset leaves the page untouched', async () => {
    const { deps } = setup();
    const data = await bytes();
    for (const over of [{ weight: Number.NaN }, { weight: 0 }, { weight: 5000 }, { weight: 450.5 }, { family: '  ' }, { family: 'A<b' }]) {
      const r = await addFont(deps, { bytes: data, name: 'x.woff2', source: 'upload', ...over });
      expect(r.ok ? 'ok' : r.error.code, JSON.stringify(over)).toBe('FONT_INVALID');
    }
    const before = document.fonts.size;
    const refused = await addFont(
      { ...deps, execute: () => ({ ok: false, error: { code: 'COMMAND_UNKNOWN', message: 'no', diagnostics: [] } }) },
      { bytes: data, name: 'x.woff2', source: 'upload', family: 'Fx Refused' },
    );
    expect(refused.ok ? 'ok' : refused.error.code).toBe('FONT_CORRUPT');
    expect(document.fonts.size).toBe(before);
    expect([...document.fonts].some((f) => f.family.includes('Fx Refused'))).toBe(false);
  }, 60_000);
});
