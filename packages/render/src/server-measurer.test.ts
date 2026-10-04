import { createMetricsMeasurer, type FaceMetrics } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { createFixedMeasurer, FIXED_ADVANCE_EM, serverMeasurer } from './server-measurer.js';

const face = (family: string, advance: number): FaceMetrics => ({
  family,
  weight: 400,
  style: 'normal',
  unitsPerEm: 1000,
  advances: { a: advance, b: advance * 2 },
  defaultAdvance: advance,
  pairs: { ab: -100 },
  triples: {},
});

describe('measuring text without a canvas (FR-TXT-002, ADR-0148)', () => {
  it('FR-TXT-002: a font with recorded metrics is measured by adding them up, kerning included, as the browser does with the same table', () => {
    const faces = [face('Probe', 500)];
    const font = { family: '"Probe", serif', size: 10 };
    const measured = serverMeasurer(faces).measure('aab', font);
    // a(500) + a(500) + b(1000) = 2000 units, the ab pair -100 once: 1900 / 1000 * 10
    expect(measured.width).toBeCloseTo(19, 5);
    // exactly what the recorded-metrics measurer the browser builds answers
    expect(measured).toEqual(createMetricsMeasurer(faces, createFixedMeasurer()).measure('aab', font));
  });

  it("FR-TXT-002: a font with no recorded metrics is measured at the fixed advance, a line at the font's line height", () => {
    const measured = serverMeasurer([face('Probe', 500)]).measure('hello\nworld!', { family: 'Unknown Sans', size: 20, lineHeight: 1.5 });
    expect(FIXED_ADVANCE_EM).toBe(0.6);
    expect(measured.width).toBeCloseTo(6 * 0.6 * 20, 5);
    expect(measured.height).toBeCloseTo(2 * 1.5 * 20, 5);
    expect([measured.ascent, measured.descent]).toEqual([16, 4]);
  });

  it('FR-TXT-002: the fixed measurer counts characters, not UTF-16 units, and the widest line wins', () => {
    const m = createFixedMeasurer(0.5);
    expect(m.measure('a😀b', { family: 'x', size: 10 }).width).toBeCloseTo(15, 5);
    expect(m.measure('ab\nabcd\nabc', { family: 'x', size: 10 }).width).toBeCloseTo(20, 5);
  });
});
