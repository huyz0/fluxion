import { createMetricsMeasurer } from '@fluxion/core';
import { browserMeasurer, createCanvasMeasurer } from '@fluxion/editor';
import { FONT_METRICS } from '@fluxion/pack-fonts-core';
import { describe, expect, it } from 'vitest';
import { bundledFaces, bundledFontUrl, embeddableFaces, loadBundledFonts } from './fonts.js';

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

  it('FR-THM-008: a document in a bundled font measures within 1 px on the metrics path', async () => {
    await loadBundledFonts();
    const measurer = browserMeasurer();
    expect(measurer).toBeDefined();
    const texts = [
      'Fluxion',
      'The quick brown fox jumps over the lazy dog',
      'AVATAR Tavern WAVE Yo-yo To We Ty',
      'ffi fl fi office affluent',
      '0123456789 +-*/=<> (a[b]{c})',
      'He said “hello” – then left…',
    ];
    const rendered = (text: string, face: { family: string; weight: number; style: string; size: number }): number => {
      const span = document.createElement('span');
      span.textContent = text;
      span.style.cssText = `position:absolute;white-space:pre;text-rendering:geometricPrecision;font:${face.style} ${face.weight} ${face.size}px "${face.family}"`;
      document.body.append(span);
      const width = span.getBoundingClientRect().width;
      span.remove();
      return width;
    };
    // the metrics path was taken: the shared measurer gives exactly what the recorded metrics add up to, which the canvas does not for kerned text
    const reference = createMetricsMeasurer(FONT_METRICS, createCanvasMeasurer());
    const kerned = { family: '"Inter", sans-serif', size: 32, weight: 400, style: 'normal' } as const;
    expect(measurer?.measure(texts[2] as string, kerned).width).toBe(reference.measure(texts[2] as string, kerned).width);
    expect(measurer?.measure(texts[2] as string, kerned).width).not.toBe(createCanvasMeasurer().measure(texts[2] as string, kerned).width);
    let worst = 0;
    for (const family of ['Inter', 'Source Serif 4', 'JetBrains Mono']) {
      for (const [weight, style, size] of [
        [400, 'normal', 16],
        [700, 'normal', 24],
        [400, 'italic', 14],
        [700, 'italic', 12],
      ] as const) {
        for (const text of texts) {
          const measured = measurer?.measure(text, { family: `"${family}", sans-serif`, size, weight, style }).width ?? Number.NaN;
          worst = Math.max(worst, Math.abs(measured - rendered(text, { family, weight, style, size })));
        }
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it('NFR-LIC-003: every bundled face can be read for embedding as a WOFF2 file with its recorded metrics, copyright line and licence', async () => {
    const faces = embeddableFaces();
    expect(faces).toHaveLength(12);
    for (const face of faces) {
      const bytes = await face.bytes();
      expect(new TextDecoder().decode(bytes?.subarray(0, 4)), `${face.family} ${face.weight} ${face.style}`).toBe('wOF2');
      expect(face.metrics, face.name).toMatchObject({ family: face.family, weight: face.weight, style: face.style });
      expect(face.license).toBe('OFL-1.1');
      expect(face.copyright, face.name).not.toBe('');
    }
  });
});
