import { readFontMetrics } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { recordFaceMetrics } from './font-recorder.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const FONTS = import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true });
const METRICS = import.meta.glob('../../../fixtures/fonts/roboto.metrics.json', { query: '?raw', import: 'default', eager: true });

const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

describe('recording font metrics in the page (FR-THM-008, ADR-0148)', () => {
  it('FR-THM-008: an uploaded font gets a metrics record equal to the one recorded for it by the script', async () => {
    const url = Object.values(FONTS)[0] as string;
    const committed = readFontMetrics(JSON.parse(Object.values(METRICS)[0] as string)).faces.find((f) => f.weight === 400);
    expect(committed).toBeDefined();
    if (committed === undefined) return;
    const before = document.fonts.size;
    const recorded = await recordFaceMetrics(await bytesOf(url), { family: 'Roboto', weight: 400, style: 'normal' });
    // the recording face was removed again
    expect(document.fonts.size).toBe(before);
    expect(recorded).toMatchObject({ family: 'Roboto', weight: 400, style: 'normal', unitsPerEm: 1000 });
    const near = (a: { readonly [k: string]: number }, b: { readonly [k: string]: number }) => {
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const k of Object.keys(a)) expect(Math.abs((a[k] as number) - (b[k] as number)), k).toBeLessThanOrEqual(0.011);
    };
    near(recorded.advances, committed.advances);
    near(recorded.pairs, committed.pairs);
    near(recorded.triples, committed.triples);
    expect(Math.abs(recorded.defaultAdvance - committed.defaultAdvance)).toBeLessThanOrEqual(0.011);
  }, 60_000);

  it('FR-THM-008: bytes the browser cannot load as a font reject, and leave nothing in the page', async () => {
    const before = document.fonts.size;
    await expect(recordFaceMetrics(new Uint8Array([1, 2, 3, 4]), { family: 'X', weight: 400, style: 'normal' })).rejects.toBeDefined();
    expect(document.fonts.size).toBe(before);
  });
});
