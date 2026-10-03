import { afterEach, describe, expect, it } from 'vitest';
import { loadFontFaces } from './font-loader.js';
import { createCanvasMeasurer } from './text-measurer.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
// the bundled Inter files, served by the bundler (a glob: the test reads no pack through an import)
const FILES = import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-*-normal.woff2', { query: '?url', import: 'default', eager: true });
const regular = FILES['../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2'] as string;
const bold = FILES['../../../packs/fonts-core/fonts/inter-latin-700-normal.woff2'] as string;

// a family name of this test's own, so no other test's fonts are in play
const FAMILY = 'FxFontLoaderTest';
const font = { family: FAMILY, size: 32 };
const added: FontFace[] = [];
afterEach(() => {
  for (const face of added.splice(0)) document.fonts.delete(face);
});
const track = () => {
  const before = new Set(document.fonts);
  return () => {
    for (const face of document.fonts) if (!before.has(face)) added.push(face);
  };
};

describe('loading fonts (FR-THM-008)', () => {
  it('FR-THM-008: after the font loads, the measured width changes and the cache key includes the font', async () => {
    const done = track();
    const measurer = createCanvasMeasurer();
    const text = 'Hamburgefonstiv 0123456789';
    const fallback = measurer.measure(text, font).width;
    // measured again from the cache: the same
    expect(measurer.measure(text, font).width).toBe(fallback);
    await loadFontFaces([{ family: FAMILY, weight: 400, style: 'normal', url: regular }]);
    done();
    // what was measured with the fallback is stale once the face is there: ready() empties the cache
    await measurer.ready();
    const inter = measurer.measure(text, font).width;
    expect(inter).not.toBe(fallback);
    // the weight is part of the key: the bold face is another width, the regular one is unchanged
    const bolder = track();
    await loadFontFaces([{ family: FAMILY, weight: 700, style: 'normal', url: bold }]);
    bolder();
    await measurer.ready();
    expect(measurer.measure(text, { ...font, weight: 700 }).width).not.toBe(inter);
    expect(measurer.measure(text, font).width).toBe(inter);
  });

  it('FR-THM-008: a face whose bytes are not a font rejects, and nothing is left loaded for it', async () => {
    const done = track();
    const rejected = await loadFontFaces([{ family: `${FAMILY}Bad`, weight: 400, style: 'normal', url: 'data:font/woff2;base64,AAAA' }]).then(
      () => false,
      () => true,
    );
    done();
    expect(rejected).toBe(true);
    expect([...document.fonts].some((f) => f.family.includes(`${FAMILY}Bad`))).toBe(false);
  });
});
