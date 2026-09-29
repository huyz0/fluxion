import { describe, expect, it } from 'vitest';
import { FixedTextMeasurer } from '../testing/fakes.js';
import { fitText, shrinksText, TEXT_FIT_DEFAULTS } from './fit.js';
import { wrapText } from './wrap.js';

// every character 0.5 em: 5 px at 10 px; lines 1.2 em
const measurer = new FixedTextMeasurer(0.5);
const font = { family: 'Inter', size: 10 };

describe('text by words (ADR-0018, FR-SHP-006)', () => {
  it('FR-SHP-006: paragraphs break into lines that fit the width, a long word standing alone', () => {
    expect(wrapText(['aaa bbb ccc'], font, 40, measurer)).toEqual({ lines: ['aaa bbb', 'ccc'], width: 35, height: 24 });
    // a line exactly as wide as the width fits
    expect(wrapText(['aaa bbb ccc'], font, 35, measurer).lines).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText(['aaa bbb ccc'], font, 34.9, measurer).lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(wrapText(['a verylongword b'], font, 20, measurer).lines).toEqual(['a', 'verylongword', 'b']);
    // spaces collapse; each paragraph starts a line; an empty paragraph is an empty line
    expect(wrapText(['  one   two ', '', 'three'], font, 1000, measurer).lines).toEqual(['one two', '', 'three']);
    expect(wrapText([], font, 100, measurer)).toEqual({ lines: [], width: 0, height: 0 });
    // a no-break space keeps its words together, and stays what it is
    expect(wrapText(['go 10 km now'], font, 30, measurer).lines).toEqual(['go', '10 km', 'now']);
    expect(wrapText(['a\tb\nc'], font, 5, measurer).lines).toEqual(['a', 'b', 'c']);
    expect(wrapText(['x'], { ...font, size: 20 }, 100, measurer)).toEqual({ lines: ['x'], width: 10, height: 24 });
  });

  it('FR-SHP-006: none and grow keep the size; shrink picks the largest size that fits, never below the minimum', () => {
    const text = ['alpha beta gamma delta epsilon'];
    const region = { w: 100, h: 40 };
    // padding 8 by default: an 84 x 24 inner box
    const none = fitText({ paragraphs: text, font, region }, measurer);
    expect(none.size).toBe(10);
    expect(none.lines).toEqual(['alpha beta gamma', 'delta epsilon']);
    expect(none.regionHeight).toBe(24 + 2 * TEXT_FIT_DEFAULTS.padding);
    expect(fitText({ paragraphs: text, font, region, fit: { mode: 'grow' } }, measurer)).toEqual(none);
    // at 20 px the text needs more than the region; shrink finds the largest size that fits
    const big = { ...font, size: 20 };
    const shrunk = fitText({ paragraphs: text, font: big, region, fit: { mode: 'shrink', minSize: 6 } }, measurer);
    expect(shrunk.size).toBeLessThan(20);
    expect(shrunk.size).toBeGreaterThanOrEqual(6);
    expect(shrunk.height).toBeLessThanOrEqual(24);
    expect(shrunk.width).toBeLessThanOrEqual(84);
    const larger = fitText({ paragraphs: text, font: { ...big, size: shrunk.size + 0.05 }, region, fit: { mode: 'none' } }, measurer);
    expect(larger.height > 24 || larger.width > 84).toBe(true);
    expect([shrinksText(undefined), shrinksText({}), shrinksText({ mode: 'grow' }), shrinksText({ mode: 'shrink' })]).toEqual([false, false, false, true]);
    // text exactly as wide as the inner box fits
    expect(fitText({ paragraphs: ['abcdefghij'], font, region: { w: 50, h: 20 }, fit: { mode: 'shrink', padding: 0 } }, measurer).size).toBe(10);
    // text that already fits keeps its size
    expect(fitText({ paragraphs: ['ok'], font: big, region, fit: { mode: 'shrink' } }, measurer).size).toBe(20);
    // nothing fits: the minimum, even when it overflows
    const floor = fitText({ paragraphs: ['unbreakablewordthatislong'], font: big, region, fit: { mode: 'shrink', minSize: 9 } }, measurer);
    expect(floor.size).toBe(9);
    // a minimum above the size is the size; padding may be set, and a region smaller than it is empty
    expect(fitText({ paragraphs: ['unbreakablewordthatislong'], font, region, fit: { mode: 'shrink', minSize: 30 } }, measurer).size).toBe(10);
    expect(fitText({ paragraphs: text, font, region, fit: { padding: 0 } }, measurer).regionHeight).toBe(24);
    const tiny = fitText({ paragraphs: ['a b'], font, region: { w: 10, h: 10 }, fit: { mode: 'shrink', padding: 8, minSize: 1 } }, measurer);
    expect(tiny.size).toBe(1);
  });
});
