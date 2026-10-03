import { describe, expect, it } from 'vitest';
import { bundledFaces, bundledFontUrl, loadBundledFonts } from './fonts.js';

describe('the studio loads the bundled fonts (FR-THM-008, ADR-0022)', () => {
  it('FR-THM-008: every bundled face has a served URL, and after loading the page draws with the three families', async () => {
    expect(bundledFaces()).toHaveLength(12);
    expect(bundledFaces().every((f) => f.url !== '')).toBe(true);
    expect(bundledFontUrl('fonts/not-there.woff2')).toBeUndefined();
    await loadBundledFonts();
    for (const family of ['Inter', 'Source Serif 4', 'JetBrains Mono']) {
      expect(document.fonts.check(`400 16px "${family}"`, 'Hello'), family).toBe(true);
      expect(document.fonts.check(`italic 700 16px "${family}"`, 'Hello'), family).toBe(true);
    }
    // twelve distinct faces, all loaded: a failed italic or bold face would not hide behind a loaded regular one
    const faces = [...document.fonts].filter((f) => bundledFaces().some((b) => b.family === f.family.replaceAll('"', '')));
    expect(faces).toHaveLength(12);
    expect(faces.every((f) => f.status === 'loaded')).toBe(true);
    expect(new Set(faces.map((f) => `${f.family}${f.weight}${f.style}`)).size).toBe(12);
    // asking again adds nothing
    await loadBundledFonts();
    expect([...document.fonts].filter((f) => bundledFaces().some((b) => b.family === f.family.replaceAll('"', '')))).toHaveLength(12);
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', ''));
    expect(new Set(loaded)).toEqual(new Set(['Inter', 'Source Serif 4', 'JetBrains Mono']));
  });
});
