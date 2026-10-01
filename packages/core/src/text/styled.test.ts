import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FontSpec, TextMeasurer, TextMetrics } from '../ports/ports.js';
import { fitText } from './fit.js';
import { type StyledBlock, wrapStyled } from './styled.js';
import { wrapText } from './wrap.js';

/** Every character is `size / 2` wide, bold ones 10 % more; the calls are recorded. */
function measurer() {
  const calls: string[] = [];
  const m: TextMeasurer = {
    measure(text: string, font: FontSpec): TextMetrics {
      calls.push(`${font.size}/${font.weight}/${font.style}:${text}`);
      const w = Math.max(...text.split('\n').map((l) => [...l].length)) * font.size * 0.5 * ((font.weight ?? 400) >= 700 ? 1.1 : 1);
      return { width: w, height: text.split('\n').length * (font.lineHeight ?? 1.2) * font.size, ascent: 0, descent: 0 };
    },
  };
  return { m, calls };
}
const base: FontSpec = { family: 'Test', size: 10, lineHeight: 1.5 };
const plain = (text: string, over: Partial<StyledBlock> = {}): StyledBlock => ({ runs: [{ text }], ...over });

describe('text laid out as it is drawn (FR-TXT-002, FR-SHP-006)', () => {
  it('FR-TXT-002: plain text lays out as the plain wrap does: the same lines, width and height', () => {
    const { m } = measurer();
    const words = fc.array(fc.stringMatching(/^[a-z]{1,9}$/), { minLength: 1, maxLength: 12 }).map((w) => w.join(' '));
    fc.assert(
      fc.property(fc.array(words, { minLength: 1, maxLength: 4 }), fc.integer({ min: 5, max: 200 }), (paragraphs, maxWidth) => {
        const styled = wrapStyled(
          paragraphs.map((p) => plain(p)),
          base,
          m,
          { maxWidth },
        );
        const old = wrapText(paragraphs, base, maxWidth, m);
        expect(styled.lines).toEqual(old.lines);
        expect(styled.width).toBeCloseTo(old.width, 9);
        expect(styled.height).toBeCloseTo(old.height, 9);
      }),
    );
  });

  it('FR-TXT-002: a run with its own size is measured at it, and its line is as tall as that size at the line height', () => {
    const { m } = measurer();
    // "ab " at 10 (5 px a char) then "CD" at 30 (15 px a char): 15 + 30 = 45 wide, tallest 30 at 1.5
    const r = wrapStyled([{ runs: [{ text: 'ab ' }, { text: 'CD', size: 30 }] }], base, m, { maxWidth: 1000 });
    expect(r.lines).toEqual(['ab CD']);
    expect(r.width).toBe(5 * 3 + 15 * 2);
    expect(r.height).toBe(30 * 1.5);
    // the line it is not on keeps the block's height
    const two = wrapStyled([{ runs: [{ text: 'ab ' }, { text: 'CD', size: 30 }, { text: ' ef gh' }] }], base, m, { maxWidth: 50 });
    expect(two.lines).toEqual(['ab CD', 'ef gh']);
    expect(two.height).toBe(30 * 1.5 + 10 * 1.5);
  });

  it('FR-TXT-002: bold, italic and family runs are measured in their font; an inline code run is a multiple of the block`s size', () => {
    const { m, calls } = measurer();
    wrapStyled(
      [
        {
          runs: [
            { text: 'a', weight: 700 },
            { text: 'b', style: 'italic' },
            { text: 'c', em: 0.5 },
            { text: 'd', family: 'Mono' },
          ],
        },
      ],
      base,
      m,
      { maxWidth: 1000 },
    );
    // (the line is measured as it grows; the last call is the whole line, a piece per font)
    expect(calls.slice(-4)).toEqual(['10/700/normal:a', '10/400/italic:b', '5/400/normal:c', '10/400/normal:d']);
    // the weight of a heading is the block's, a run's own wins
    const heading = measurer();
    wrapStyled([{ runs: [{ text: 'x' }, { text: 'y', weight: 400 }], weight: 700 }], base, heading.m, { maxWidth: 1000 });
    expect(heading.calls.slice(-2)).toEqual(['10/700/normal:x', '10/400/normal:y']);
  });

  it('FR-TXT-002: pieces of one font are measured together, so kerning across words is the measurer`s; another font splits them', () => {
    const { m, calls } = measurer();
    wrapStyled([{ runs: [{ text: 'one two ' }, { text: 'three', weight: 700 }, { text: ' four' }] }], base, m, { maxWidth: 1000 });
    // the line is measured as it grows (each candidate) and once at the end: the widest call shows the pieces
    expect(calls.at(-3)).toBe('10/400/normal:one two ');
    expect(calls.at(-2)).toBe('10/700/normal:three');
    expect(calls.at(-1)).toBe('10/400/normal: four');
    const plainOne = measurer();
    wrapStyled([plain('one two four')], base, plainOne.m, { maxWidth: 1000 });
    expect(plainOne.calls.at(-1)).toBe('10/400/normal:one two four');
  });

  it('FR-TXT-002: a heading is the base size times its scale, in bold; a block`s own line height replaces the base one', () => {
    const { m } = measurer();
    const h = wrapStyled([plain('abcd', { scale: 2, weight: 700 })], base, m, { maxWidth: 1000 });
    expect(h.width).toBe(4 * 20 * 0.5 * 1.1);
    expect(h.height).toBe(20 * 1.5);
    expect(wrapStyled([plain('ab', { lineHeight: 2 })], base, m, { maxWidth: 1000 }).height).toBe(10 * 2);
    // a run bigger than the heading makes its line taller; a smaller one does not
    expect(wrapStyled([{ runs: [{ text: 'a' }, { text: 'b', size: 40 }], scale: 2 }], base, m, { maxWidth: 1000 }).height).toBe(40 * 1.5);
    expect(wrapStyled([{ runs: [{ text: 'a' }, { text: 'b', size: 5 }], scale: 2 }], base, m, { maxWidth: 1000 }).height).toBe(20 * 1.5);
  });

  it('FR-TXT-002: the space around blocks is added in a flex column and collapsed in a block layout', () => {
    const { m } = measurer();
    const blocks = [plain('a', { before: 4, after: 10 }), plain('b', { before: 6, after: 2 }), plain('c', { before: 3 })];
    const lines = 3 * 10 * 1.5;
    // add: 4 + (10 + 6) + (2 + 3) + 0
    expect(wrapStyled(blocks, base, m, { maxWidth: 1000 }).height).toBe(lines + 4 + 16 + 5);
    // collapse: 4 + max(10, 6) + max(2, 3) + 0
    expect(wrapStyled(blocks, base, m, { maxWidth: 1000, spacing: 'collapse' }).height).toBe(lines + 4 + 10 + 3);
    expect(wrapStyled([plain('a', { after: 7 })], base, m, { maxWidth: 1000 }).height).toBe(15 + 7);
    expect(wrapStyled([], base, m, { maxWidth: 1000 })).toEqual({ lines: [], width: 0, height: 0 });
  });

  it('FR-TXT-002: the blocks of a list are in a block layout whatever holds the list: their margins collapse, those around the list add', () => {
    const { m } = measurer();
    const item = (text: string, over: Partial<StyledBlock>) => plain(text, { indentEm: 1.5, ...over });
    const lines = 4 * 15;
    // two items: 10 after, 6 before collapse to 10; the paragraph before (12 after) and the first item (3 before) add; likewise after the list
    const blocks = [plain('p', { after: 12 }), item('a', { before: 3, after: 10 }), item('b', { before: 6, after: 4 }), plain('q', { before: 8 })];
    expect(wrapStyled(blocks, base, m, { maxWidth: 1000 }).height).toBe(lines + 12 + 3 + 10 + (4 + 8));
    // in a block layout every pair collapses, the list's included
    expect(wrapStyled(blocks, base, m, { maxWidth: 1000, spacing: 'collapse' }).height).toBe(lines + Math.max(12, 3) + 10 + Math.max(4, 8));
    // a list after a list item only collapses with indented blocks: an unindented one after an item adds
    expect(wrapStyled([item('a', { after: 5 }), plain('b', { before: 7 })], base, m, { maxWidth: 1000 }).height).toBe(30 + 5 + 7);
    expect(wrapStyled([plain('a', { after: 5 }), item('b', { before: 7 })], base, m, { maxWidth: 1000 }).height).toBe(30 + 5 + 7);
  });

  it('FR-TXT-002: an indented block wraps in the width left and counts its indent in the width; the indent follows the base size', () => {
    const { m } = measurer();
    // base 10: 1.5 em is 15 px; "ab cd" is 25 px, so in 40 px less 15 it just fits
    expect(wrapStyled([plain('ab cd', { indentEm: 1.5 })], base, m, { maxWidth: 40 }).lines).toEqual(['ab cd']);
    expect(wrapStyled([plain('ab cd', { indentEm: 1.5 })], base, m, { maxWidth: 39 }).lines).toEqual(['ab', 'cd']);
    expect(wrapStyled([plain('ab', { indentEm: 3 })], base, m, { maxWidth: 1000 }).width).toBe(10 + 30);
    expect(wrapStyled([plain('ab', { indentEm: 3 })], { ...base, size: 20 }, m, { maxWidth: 1000 }).width).toBe(20 + 60);
    // an indent wider than the box leaves no room: each word stands alone
    expect(wrapStyled([plain('ab cd', { indentEm: 9 })], base, m, { maxWidth: 40 }).lines).toEqual(['ab', 'cd']);
  });

  it('FR-TXT-002: hard breaks start lines; a trailing one adds none; a block with no text has no line; white space collapses', () => {
    const { m } = measurer();
    expect(wrapStyled([plain('a\nb')], base, m, { maxWidth: 1000 }).lines).toEqual(['a', 'b']);
    expect(wrapStyled([plain('a\n\nb')], base, m, { maxWidth: 1000 }).lines).toEqual(['a', '', 'b']);
    expect(wrapStyled([plain('a\n')], base, m, { maxWidth: 1000 }).lines).toEqual(['a']);
    expect(wrapStyled([plain('\n')], base, m, { maxWidth: 1000 }).lines).toEqual(['']);
    expect(wrapStyled([plain('')], base, m, { maxWidth: 1000 })).toEqual({ lines: [], width: 0, height: 0 });
    expect(wrapStyled([{ runs: [] }], base, m, { maxWidth: 1000 }).height).toBe(0);
    expect(wrapStyled([plain('   ')], base, m, { maxWidth: 1000 }).lines).toEqual([]);
    expect(wrapStyled([plain('  a \t b  ')], base, m, { maxWidth: 1000 }).lines).toEqual(['a b']);
    // every kind of white space but a no-break space separates words, and a run of it is one space
    expect(wrapStyled([plain('a\tb\rc\fd\ve  f')], base, m, { maxWidth: 1000 }).lines).toEqual(['a b c d e f']);
    // a no-break space keeps its words together, as in the plain wrap
    expect(wrapStyled([plain('a b c')], base, m, { maxWidth: 20 }).lines).toEqual(['a b', 'c']);
  });

  it('FR-TXT-002: a word wider than the line stands alone, and the next one starts another', () => {
    const { m } = measurer();
    const r = wrapStyled([plain('abcdefghij kl')], base, m, { maxWidth: 20 });
    expect(r.lines).toEqual(['abcdefghij', 'kl']);
    expect(r.width).toBe(50);
  });

  it('FR-SHP-006: a fit lays out the blocks instead of the paragraphs; shrinking moves the base size, not a run`s own', () => {
    const { m } = measurer();
    const blocks: StyledBlock[] = [{ runs: [{ text: 'aa bb cc dd' }] }, { runs: [{ text: 'big', size: 40 }] }];
    const region = { w: 60, h: 100 };
    const grow = fitText(
      { paragraphs: ['aa bb cc dd', 'big'], blocks, font: { family: 'Test', size: 10, lineHeight: 1 }, region, fit: { mode: 'grow', padding: 0 } },
      m,
    );
    // base 10: "aa bb cc dd" is 55 px wide, one line of 10; "big" at 40 is 60 wide, 40 tall
    expect([grow.lines, grow.height]).toEqual([['aa bb cc dd', 'big'], 50]);
    const shrunk = fitText(
      {
        paragraphs: [''],
        blocks,
        font: { family: 'Test', size: 10, lineHeight: 1 },
        region: { w: 60, h: 45 },
        fit: { mode: 'shrink', padding: 0, minSize: 2 },
      },
      m,
    );
    // the 40 px run keeps 40 px, so the text only fits at a base size that leaves the first block on one line of the 5 px left
    expect(shrunk.size).toBeLessThan(10);
    expect(shrunk.height).toBeLessThanOrEqual(45);
    // paragraphs only say there is text once blocks are given
    const fromParagraphs = fitText(
      { paragraphs: ['aa bb cc dd', 'big'], font: { family: 'Test', size: 10, lineHeight: 1 }, region, fit: { mode: 'grow', padding: 0 } },
      m,
    );
    expect(fromParagraphs.height).toBe(20);
  });
});
