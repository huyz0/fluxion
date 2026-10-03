import { createCoreRegistries, createFontRegistry } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { FONTS_CORE, fontUrl } from './index.js';
import { MANIFEST } from './manifest.js';

describe('the fonts-core pack (FR-THM-008)', () => {
  it('FR-THM-008: the pack lists three families in weights 400 and 700, upright and italic, all OFL-1.1', () => {
    const fonts = createFontRegistry();
    expect(fonts.register(FONTS_CORE).ok).toBe(true);
    expect(fonts.families().map((f) => [f.family, f.faces.length])).toEqual([
      ['Inter', 4],
      ['Source Serif 4', 4],
      ['JetBrains Mono', 4],
    ]);
    expect(FONTS_CORE.every((f) => f.source === 'bundled' && f.license === 'OFL-1.1' && (f.copyright ?? '') !== '')).toBe(true);
    expect(new Set(FONTS_CORE.map((f) => `${f.weight}${f.style}`))).toEqual(new Set(['400normal', '700normal', '400italic', '700italic']));
    // a pack of fonts registers no theme, shape or marker
    expect(createCoreRegistries().themes.list()).toEqual([]);
  });

  it("FR-THM-008: every face names its own woff2 file with the manifest's hash (the licence gate checks the bytes)", () => {
    expect(new Set(FONTS_CORE.map((f) => f.file)).size).toBe(FONTS_CORE.length);
    expect(FONTS_CORE.map((f) => f.file)).toEqual(MANIFEST.map((f) => f.file));
    expect(MANIFEST.every((f) => /^fonts\/[a-z0-9-]+\.woff2$/.test(f.file) && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });

  it('FR-THM-008: a face file has a URL under the base a host serves the package folder at', () => {
    const face = FONTS_CORE[0];
    expect(face).toBeDefined();
    if (!face) return;
    expect(fontUrl(face, 'https://example.test/assets/')).toBe('https://example.test/assets/fonts/inter-latin-400-normal.woff2');
  });
});
