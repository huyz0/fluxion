import { FONT_METRICS } from '@fluxion/pack-fonts-core';
import type { DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { measurerFor } from './measurer.js';

const empty = { schemaVersion: '1.2', records: {} } as unknown as DocumentFile;
const withFont = (family: string, advance: number): DocumentFile =>
  ({
    schemaVersion: '1.2',
    records: {
      f1: {
        id: 'f1',
        type: 'asset',
        hash: 'a'.repeat(64),
        mime: 'font/woff2',
        size: 1,
        name: 'f.woff2',
        font: {
          family,
          weight: 400,
          style: 'normal',
          metrics: { family, weight: 400, style: 'normal', unitsPerEm: 1000, advances: {}, defaultAdvance: advance, pairs: {}, triples: {} },
        },
      },
    },
  }) as unknown as DocumentFile;

describe('how the command line measures text (FR-TXT-002, ADR-0148)', () => {
  it('FR-TXT-002: the CLI measures text with the recorded metrics, and a font with none with the fixed fallback', () => {
    const m = measurerFor(empty);
    // a bundled face: the sum of its recorded advances (and pairs), the table the browser adds up
    const inter = FONT_METRICS.find((f) => f.family === 'Inter' && f.weight === 400 && f.style === 'normal');
    expect(inter).toBeDefined();
    const font = { family: '"Inter", system-ui, sans-serif', size: 16 };
    const text = 'Hello';
    const units = [...text].reduce((sum, ch) => sum + (inter?.advances[ch] ?? inter?.defaultAdvance ?? 0), 0);
    const pairs = [...text].slice(1).reduce((sum, ch, i) => sum + (inter?.pairs[(text[i] ?? '') + ch] ?? 0), 0);
    expect(m.measure(text, font).width).toBeGreaterThan(0);
    expect(Math.abs(m.measure(text, font).width - ((units + pairs) / (inter?.unitsPerEm ?? 1)) * 16)).toBeLessThan(0.5);
    // a font nothing recorded: 0.6 em a character
    expect(m.measure('Hello', { family: 'Nobody Sans', size: 10 }).width).toBeCloseTo(30, 5);
  });

  it('FR-TXT-002: the metrics a document embeds with its fonts measure that font, and a table that is not well formed is ignored', () => {
    const font = { family: 'Embedded Probe', size: 10 };
    expect(measurerFor(withFont('Embedded Probe', 700)).measure('abcd', font).width).toBeCloseTo(28, 5);
    const damaged = withFont('Embedded Probe', 700);
    (damaged.records['f1'] as unknown as { font: { metrics: unknown } }).font.metrics = { family: 'Embedded Probe', unitsPerEm: 'wide' };
    expect(measurerFor(damaged).measure('abcd', font).width).toBeCloseTo(24, 5);
  });
});
