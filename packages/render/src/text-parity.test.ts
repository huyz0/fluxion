import { createMetricsMeasurer, readFontMetrics, type TextMeasurer } from '@fluxion/core';
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the recorded font metrics and what a browser rendered for the same samples (scripts/fonts/record-metrics.mjs)
const FILES = import.meta.glob('../../../fixtures/fonts/*.json', { query: '?raw', import: 'default', eager: true });
const json = (name: string): unknown => JSON.parse(FILES[`../../../fixtures/fonts/${name}`] ?? 'null');

type Sample = { readonly text: string; readonly size: number; readonly weight: number; readonly width: number; readonly height: number };
const samples = (json('roboto.rendered.json') as { readonly samples: readonly Sample[] }).samples;
const unknownFont: TextMeasurer = {
  measure: () => {
    throw new Error('a recorded font must not reach the fallback');
  },
};

describe('measured text equals rendered text (FR-TXT-002, ADR-0148)', () => {
  it('FR-TXT-002: measured size equals rendered size ±1 px', () => {
    const measurer = createMetricsMeasurer(readFontMetrics(json('roboto.metrics.json')).faces, unknownFont);
    // not vacuous: many samples, in several sizes and weights, one-line and multi-line
    expect(samples.length).toBeGreaterThanOrEqual(40);
    expect(new Set(samples.map((s) => s.size)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(samples.map((s) => s.weight))).toEqual(new Set([400, 700]));
    expect(samples.some((s) => s.text.includes('\n'))).toBe(true);
    const errors = samples.map((s) => {
      const m = measurer.measure(s.text, { family: 'Roboto', size: s.size, weight: s.weight, lineHeight: 1.2 });
      return { sample: `${s.size}px/${s.weight} ${s.text.slice(0, 24)}`, width: Math.abs(m.width - s.width), height: Math.abs(m.height - s.height) };
    });
    const worst = (key: 'width' | 'height') => errors.reduce((a, b) => (b[key] > a[key] ? b : a));
    expect(worst('width').width, `width of ${worst('width').sample}`).toBeLessThanOrEqual(1);
    expect(worst('height').height, `height of ${worst('height').sample}`).toBeLessThanOrEqual(1);
  });

  it('FR-TXT-002: the recorded metrics hold the faces the samples use, and a family list picks the first', () => {
    const faces = readFontMetrics(json('roboto.metrics.json')).faces;
    expect(faces.map((f) => [f.family, f.weight, f.style, f.unitsPerEm])).toEqual([
      ['Roboto', 400, 'normal', 1000],
      ['Roboto', 700, 'normal', 1000],
    ]);
    const measurer = createMetricsMeasurer(faces, unknownFont);
    const plain = measurer.measure('Fluxion', { family: 'Roboto', size: 16 }).width;
    expect(measurer.measure('Fluxion', { family: '"Roboto", sans-serif', size: 16 }).width).toBe(plain);
    // kerning is part of the numbers: "AV" is narrower than "A" and "V" apart
    const [a, v, av] = ['A', 'V', 'AV'].map((t) => measurer.measure(t, { family: 'Roboto', size: 100 }).width);
    expect(av).toBeLessThan((a as number) + (v as number) - 1);
  });
});
