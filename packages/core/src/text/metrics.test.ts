import { describe, expect, it } from 'vitest';
import type { FontSpec, TextMeasurer } from '../ports/ports.js';
import { createMetricsMeasurer, type FaceMetrics, readFontMetrics } from './metrics.js';

/** A face of 1000 units per em where `a` is 500, `b` 600, `c` 700, and "ab" kerns by -50. */
const face = (over: Partial<FaceMetrics> = {}): FaceMetrics => ({
  family: 'Test',
  weight: 400,
  style: 'normal',
  unitsPerEm: 1000,
  advances: { a: 500, b: 600, c: 700, ' ': 250, '😀': 1200 },
  defaultAdvance: 400,
  pairs: { ab: -50, ' a': 20 },
  triples: {},
  ...over,
});
const font = (over: Partial<FontSpec> = {}): FontSpec => ({ family: 'Test', size: 10, ...over });
const fallback: TextMeasurer = { measure: (text) => ({ width: -1, height: -1, ascent: text.length, descent: -1 }) };
const width = (faces: readonly FaceMetrics[], text: string, f: FontSpec = font()) => createMetricsMeasurer(faces, fallback).measure(text, f).width;

describe('text measured from recorded metrics (FR-TXT-002, ADR-0148)', () => {
  it('FR-TXT-002: a line is the sum of its advances and pair adjustments, scaled to the size', () => {
    expect(width([face()], 'a')).toBe(5);
    expect(width([face()], 'abc')).toBeCloseTo((500 + 600 + 700 - 50) * 0.01, 10);
    expect(width([face()], 'abc', font({ size: 20 }))).toBeCloseTo((500 + 600 + 700 - 50) * 0.02, 10);
    // a pair is adjusted where it stands, also after a space; a pair not recorded adds nothing
    expect(width([face()], 'a a')).toBeCloseTo((500 + 250 + 500 + 20) * 0.01, 10);
    expect(width([face()], 'ba')).toBeCloseTo((600 + 500) * 0.01, 10);
    expect(width([face()], '')).toBe(0);
    // a different recording size scales the same
    expect(width([face({ unitsPerEm: 2000, advances: { a: 1000 }, pairs: {} })], 'a')).toBe(5);
  });

  it('FR-TXT-002: a three-letter sequence adds what it changes beyond its parts and its two pairs, wherever it stands', () => {
    const ligatured = face({ triples: { abc: -120 } });
    const parts = 500 + 600 + 700 - 50;
    expect(width([ligatured], 'abc')).toBeCloseTo((parts - 120) * 0.01, 10);
    expect(width([ligatured], 'cabc')).toBeCloseTo((parts + 700 - 120) * 0.01, 10);
    // overlapping sequences each count: "abcabc" holds abc twice
    expect(width([ligatured], 'abcabc')).toBeCloseTo((2 * parts - 240) * 0.01, 10);
    // a sequence that is not recorded adds nothing, and neither does one split by another character
    expect(width([ligatured], 'acb')).toBeCloseTo((500 + 700 + 600) * 0.01, 10);
    expect(width([ligatured], 'ab c')).toBeCloseTo((500 + 600 + 250 + 700 - 50) * 0.01, 10);
  });

  it('FR-TXT-002: a character with no advance recorded has the default one; a character outside the BMP is one character', () => {
    expect(width([face()], 'z')).toBeCloseTo(4, 10);
    expect(width([face()], 'a😀')).toBeCloseTo((500 + 1200) * 0.01, 10);
    expect(width([face()], '😀😀')).toBeCloseTo(24, 10);
  });

  it('FR-TXT-002: lines are split at newlines: the width is the widest, the height all of them', () => {
    const m = createMetricsMeasurer([face()], fallback).measure('a\nabc\nb', font({ size: 10, lineHeight: 1.5 }));
    expect(m.width).toBeCloseTo((500 + 600 + 700 - 50) * 0.01, 10);
    expect(m.height).toBe(3 * 1.5 * 10);
    // the default line height is 1.2; ascent and descent are those of the canvas measurer
    const one = createMetricsMeasurer([face()], fallback).measure('a', font({ size: 20 }));
    expect([one.height, one.ascent, one.descent]).toEqual([24, 16, 4]);
  });

  it('FR-TXT-002: the face is chosen by family (first of the list, quoted or not, any case), style, then the nearest weight', () => {
    const faces = [
      face({ weight: 400, advances: { a: 100 } }),
      face({ weight: 700, advances: { a: 200 } }),
      face({ weight: 400, style: 'italic', advances: { a: 300 } }),
      face({ family: 'Other', advances: { a: 900 } }),
    ];
    const a = (f: Partial<FontSpec>) => width(faces, 'a', font({ size: 1000, ...f })) / 1;
    expect([a({}), a({ weight: 700 }), a({ weight: 600 }), a({ weight: 500 }), a({ weight: 900 })]).toEqual([100, 200, 200, 100, 200]);
    // halfway between two weights: the heavier
    expect(a({ weight: 550 })).toBe(200);
    expect([a({ family: '"test", serif' }), a({ family: "'TEST'" }), a({ family: ' test ,serif' }), a({ family: 'Other, Test' })]).toEqual([
      100, 100, 100, 900,
    ]);
    expect([a({ style: 'italic' }), a({ style: 'italic', weight: 700 }), a({ style: 'oblique' })]).toEqual([300, 300, 100]);
  });

  it('FR-TXT-002: ties and gaps in the faces: the heavier of two as near, the first of two alike, the normal face when the style is missing', () => {
    const w = (faces: readonly FaceMetrics[], f: Partial<FontSpec>) => width(faces, 'a', font({ size: 1000, ...f }));
    const [light, heavy] = [face({ weight: 400, advances: { a: 100 } }), face({ weight: 700, advances: { a: 200 } })];
    // 550 is as near 400 as 700 is: the heavier, whichever comes first
    expect([w([light, heavy], { weight: 550 }), w([heavy, light], { weight: 550 })]).toEqual([200, 200]);
    // two faces alike are one choice: the first
    expect([w([light, face({ advances: { a: 999 } })], {}), w([face({ advances: { a: 999 } }), light], {})]).toEqual([100, 999]);
    // a style no face has falls to the family's other faces; none asked for is normal, even when an italic comes first
    const italic = face({ style: 'italic', advances: { a: 300 } });
    expect([w([light], { style: 'italic' }), w([italic, light], {}), w([italic, light], { style: 'normal' })]).toEqual([100, 100, 100]);
    expect(w([italic], {})).toBe(300);
    // a quoted name is taken whole, with spaces round it ignored; unbalanced or mixed quotes are no name
    expect([w([light], { family: ' "Test" , serif' }), w([light], { family: '"Test' }), w([light], { family: `"Test'` })]).toEqual([100, -1, -1]);
  });

  it('FR-TXT-002: a font with no recorded face is measured by the fallback, whatever the text', () => {
    const m = createMetricsMeasurer([face()], fallback);
    expect(m.measure('abc', font({ family: 'Unknown' }))).toEqual({ width: -1, height: -1, ascent: 3, descent: -1 });
    expect(createMetricsMeasurer([], fallback).measure('abc', font()).width).toBe(-1);
    // a family list whose first font is unknown is not matched by a later one (the browser would use it, so does not the table)
    expect(m.measure('abc', font({ family: 'Unknown, Test' })).width).toBe(-1);
  });

  it('FR-TXT-002: a metrics file is read defensively: a face that is not well formed is left out', () => {
    const good = face();
    expect(readFontMetrics({ faces: [good] }).faces).toEqual([good]);
    // an italic face is as good as a normal one
    expect(readFontMetrics({ faces: [face({ style: 'italic' })] }).faces).toHaveLength(1);
    // a number is a number, not a string that looks like one
    expect(
      readFontMetrics({
        faces: [
          { ...good, advances: { a: '5' } },
          { ...good, pairs: { ab: '5' } },
          { ...good, triples: { abc: '5' } },
        ],
      }).faces,
    ).toEqual([]);
    // a file recorded before three-letter sequences had none
    const { triples: _none, ...old } = good;
    expect(readFontMetrics({ faces: [old] }).faces).toEqual([{ ...good, triples: {} }]);
    const bad = [
      null,
      'x',
      [],
      {},
      { ...good, family: '' },
      { ...good, family: 5 },
      { ...good, weight: '400' },
      { ...good, weight: Number.NaN },
      { ...good, style: 'oblique' },
      { ...good, unitsPerEm: 0 },
      { ...good, unitsPerEm: -1 },
      { ...good, unitsPerEm: Number.POSITIVE_INFINITY },
      { ...good, defaultAdvance: '4' },
      { ...good, defaultAdvance: Number.NaN },
      { ...good, advances: null },
      { ...good, advances: { a: '1' } },
      { ...good, advances: { a: Number.NaN } },
      { ...good, advances: [] },
      { ...good, pairs: 3 },
      { ...good, pairs: { ab: Number.POSITIVE_INFINITY } },
      { ...good, triples: 'x' },
      { ...good, triples: { abc: '1' } },
      { ...good, triples: null },
    ];
    expect(readFontMetrics({ faces: [...bad, good] }).faces).toEqual([good]);
    for (const json of [undefined, null, 5, 'x', [], {}, { faces: 'no' }, { faces: {} }]) expect(readFontMetrics(json).faces, String(json)).toEqual([]);
  });
});
