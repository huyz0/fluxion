import { browserMeasurer } from '@fluxion/editor';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { loadBundledFonts } from './fonts.js';
import { registerOpenedFonts } from './opened-fonts.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?url' | '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const WOFF2 = Object.values(import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true }))[0] ?? '';
const METRICS = JSON.parse(
  Object.values(import.meta.glob('../../../fixtures/fonts/roboto.metrics.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '{}',
) as {
  faces: { weight: number; style: string }[];
};

/** A `data:` URL of the font file. */
async function dataUrl(): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(WOFF2)).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:font/woff2;base64,${btoa(binary)}`;
}

/** A document holding one font asset `family` whose metrics are Roboto's with every advance `advance` (so a width is easy to know). */
function documentWith(family: string, advance: number, id = 'font1'): DocumentFile {
  const face = METRICS.faces.find((f) => f.weight === 400 && f.style === 'normal');
  const metrics = { ...face, family, unitsPerEm: 1000, advances: {}, defaultAdvance: advance, pairs: {}, triples: {} };
  const asset = {
    id,
    type: 'asset',
    hash: 'a'.repeat(64),
    mime: 'font/woff2',
    size: 1,
    name: 'f.woff2',
    font: { family, weight: 400, style: 'normal', metrics },
  };
  return { schemaVersion: '1.2', records: { [id]: asset } } as unknown as DocumentFile;
}
const families = () => [...document.fonts].map((f) => f.family.replaceAll('"', ''));

describe('the fonts an opened file brings (FR-THM-008, FR-FIL-006)', () => {
  it('FR-THM-008: a font asset of an opened document is loaded as a face and measures text with its recorded metrics, until the document is closed', async () => {
    const url = await dataUrl();
    const release = await registerOpenedFonts(documentWith('OpenedProbe', 700), new Map([['font1' as RecordId, url]]));
    expect(document.fonts.check('16px OpenedProbe')).toBe(true);
    const font = { family: '"OpenedProbe", serif', size: 10 };
    expect(browserMeasurer()?.measure('abcd', font).width).toBeCloseTo(28, 5);
    release();
    expect(families()).not.toContain('OpenedProbe');
    // the record is gone with it: the canvas measures the font again
    expect(browserMeasurer()?.measure('abcd', font).width).not.toBeCloseTo(28, 1);
  });

  it('FR-THM-008: a face whose bytes are not a font is left out, with no metrics registered for it', async () => {
    const bad = 'data:font/woff2;base64,AAECAwQFBgc=';
    const release = await registerOpenedFonts(documentWith('BrokenOpened', 900), new Map([['font1' as RecordId, bad]]));
    expect(families()).not.toContain('BrokenOpened');
    expect(browserMeasurer()?.measure('abcd', { family: '"BrokenOpened", serif', size: 10 }).width).not.toBeCloseTo(36, 1);
    release();
  });

  it('FR-THM-008: closing a document takes out its own faces and leaves a bundled face of the same family in place', async () => {
    await loadBundledFonts();
    const before = families().filter((f) => f === 'Inter').length;
    expect(before).toBeGreaterThan(0);
    const release = await registerOpenedFonts(documentWith('Inter', 700), new Map([['font1' as RecordId, await dataUrl()]]));
    expect(families().filter((f) => f === 'Inter').length).toBe(before + 1);
    release();
    expect(families().filter((f) => f === 'Inter').length).toBe(before);
  });

  it('FR-THM-008: closing a document that embeds Inter gives back the bundled Inter metrics it replaced while it was open', async () => {
    await loadBundledFonts();
    const font = { family: '"Inter", sans-serif', size: 16 };
    const bundled = browserMeasurer()?.measure('Hello world', font).width ?? 0;
    const release = await registerOpenedFonts(documentWith('Inter', 900), new Map([['font1' as RecordId, await dataUrl()]]));
    // while it is open the file's own table measures: every character 0.9 em
    expect(browserMeasurer()?.measure('Hello world', font).width).toBeCloseTo(11 * 0.9 * 16, 3);
    release();
    expect(browserMeasurer()?.measure('Hello world', font).width).toBeCloseTo(bundled, 3);
  });

  it('FR-THM-008: an asset with no bytes held, and one that is not a font, are skipped', async () => {
    const release = await registerOpenedFonts(documentWith('NoBytes', 500), new Map());
    expect(families()).not.toContain('NoBytes');
    release();
  });
});
