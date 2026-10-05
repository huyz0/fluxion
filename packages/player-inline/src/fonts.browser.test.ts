import type { FaceMetrics } from '@fluxion/core';
import type { LoadedFlux } from '@fluxion/format/player';
import { describe, expect, it, vi } from 'vitest';
import { loadEmbeddedFonts } from './fonts.js';

const ROBOTO = Object.values(import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true }))[0];

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const table = (over: object = {}): FaceMetrics => ({
  family: 'x',
  weight: 400,
  style: 'normal',
  unitsPerEm: 1000,
  advances: { a: 500 },
  defaultAdvance: 500,
  pairs: {},
  triples: {},
  ...over,
});

/** A loaded file holding one font asset `family` with `bytes` and a metrics table. */
function file(family: string, bytes: Uint8Array, metrics: unknown): LoadedFlux {
  const record = {
    id: 'f1',
    type: 'asset',
    hash: 'h1',
    mime: 'font/woff2',
    size: bytes.length,
    name: 'p.woff2',
    font: { family, weight: 400, style: 'normal', metrics },
  };
  return { document: { records: { f1: record } }, assets: new Map([['h1', { bytes, mime: 'font/woff2' }]]) } as unknown as LoadedFlux;
}
const roboto = async () => new Uint8Array(await (await fetch(ROBOTO ?? '')).arrayBuffer());

describe('the fonts a file carries (FR-THM-008)', () => {
  it("FR-THM-008: once the face has loaded its recorded metrics are registered under the file's family, and release takes both out", async () => {
    const register = vi.fn((_faces: readonly FaceMetrics[]) => vi.fn());
    const loaded = file('MeasuredProbe', await roboto(), table());
    const { release } = await loadEmbeddedFonts(loaded, { register });
    expect(document.fonts.check('16px MeasuredProbe')).toBe(true);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toEqual([table({ family: 'MeasuredProbe' })]);
    const unregister = register.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    release();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect([...document.fonts].some((f) => f.family.includes('MeasuredProbe'))).toBe(false);
  });

  it('FR-THM-008: a metrics table that is not well-formed is never registered, whatever else the file holds', async () => {
    const bytes = await roboto();
    const bad: unknown[] = [
      undefined,
      null,
      table({ unitsPerEm: Number.POSITIVE_INFINITY }),
      table({ unitsPerEm: 0 }),
      table({ defaultAdvance: Number.NaN }),
      table({ defaultAdvance: -1 }),
      table({ advances: { a: 'wide' } }),
      table({ pairs: { ab: null } }),
      table({ triples: [1, 2] }),
    ];
    for (const [i, metrics] of bad.entries()) {
      const register = vi.fn((_faces: readonly FaceMetrics[]) => vi.fn());
      const { release } = await loadEmbeddedFonts(file(`BadTable${i}`, bytes, metrics), { register });
      expect(register, `case ${i}`).not.toHaveBeenCalled();
      release();
    }
  });

  it('NFR-REL-002: a font asset whose font entry is not an object is skipped and the others still load', async () => {
    const bytes = await roboto();
    for (const font of [null, 5, 'roboto', [], true]) {
      const loaded = file('Odd', bytes, undefined);
      const broken = { ...loaded, document: { records: { f1: { ...(loaded.document.records['f1'] as object), font } } } } as unknown as LoadedFlux;
      const register = vi.fn((_faces: readonly FaceMetrics[]) => vi.fn());
      const { release } = await loadEmbeddedFonts(broken, { register });
      expect(register).not.toHaveBeenCalled();
      release();
    }
  });

  it('FR-THM-008: a face that does not load registers nothing', async () => {
    const register = vi.fn((_faces: readonly FaceMetrics[]) => vi.fn());
    await loadEmbeddedFonts(file('NotAFont', new Uint8Array([1, 2, 3, 4]), table()), { register });
    expect(register).not.toHaveBeenCalled();
  });
});
