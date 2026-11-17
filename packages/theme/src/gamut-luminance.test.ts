// FR-THM-005 (ADR-0055, M20.33): the palette solver's fast clamped luminance is the same number as relativeLuminance(intoGamut(...))
// at every lightness, chroma and hue, including out-of-range lightness, zero and out-of-gamut chroma and a NaN lightness.
import { describe, expect, it } from 'vitest';
import { gamutLuminance, intoGamut, relativeLuminance } from './oklch.js';

const slow = (l: number, c: number, h: number): number => relativeLuminance(intoGamut({ l, c, h, alpha: 1 }));

describe('gamutLuminance (FR-THM-005)', () => {
  it('FR-THM-005: the solver luminance equals relativeLuminance of intoGamut on a grid and at the edges', () => {
    const ls = [-0.5, -0, 0, 1e-9, 0.02, 0.37, 0.5, 0.62, 0.9, 0.999999, 1, 1.2];
    for (let i = 0; i <= 100; i++) ls.push(i / 100);
    for (const c of [0, 1e-6, 0.03, 0.12, 0.2, 0.37, 0.5]) {
      for (let h = 0; h < 360; h += 7.5) {
        const fast = gamutLuminance(c, h);
        for (const l of ls) expect(fast(l), `l ${l} c ${c} h ${h}`).toBe(slow(l, c, h));
      }
    }
  });

  it('FR-THM-005: a NaN lightness gives NaN on both paths', () => {
    expect(gamutLuminance(0.1, 30)(Number.NaN)).toBeNaN();
    expect(slow(Number.NaN, 0.1, 30)).toBeNaN();
  });
});
