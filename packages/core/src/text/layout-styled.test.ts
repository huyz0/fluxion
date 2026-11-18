import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FontSpec, TextMeasurer, TextMetrics } from '../ports/ports.js';
import { layoutStyled, type StyledBlock, wrapStyled } from './styled.js';

/** Every character is `size / 2` wide, bold ones 10 % more; ascent 0.8 and descent 0.2 of the size. */
const measurer: TextMeasurer = {
  measure(text: string, font: FontSpec): TextMetrics {
    const w = Math.max(...text.split('\n').map((l) => [...l].length)) * font.size * 0.5 * ((font.weight ?? 400) >= 700 ? 1.1 : 1);
    return { width: w, height: text.split('\n').length * (font.lineHeight ?? 1.2) * font.size, ascent: font.size * 0.8, descent: font.size * 0.2 };
  },
};
const base: FontSpec = { family: 'Test', size: 10, lineHeight: 1.5 };

const run = fc.record(
  {
    text: fc.stringMatching(/^[a-z \n]{0,24}$/),
    size: fc.constantFrom(8, 12, 20),
    weight: fc.constantFrom(400, 700),
    style: fc.constantFrom('normal', 'italic'),
  },
  { requiredKeys: ['text'] },
);
const block: fc.Arbitrary<StyledBlock> = fc.record(
  {
    runs: fc.array(run, { maxLength: 4 }),
    scale: fc.constantFrom(1, 1.5, 2),
    lineHeight: fc.constantFrom(1.2, 2),
    before: fc.integer({ min: 0, max: 12 }),
    after: fc.integer({ min: 0, max: 12 }),
    indentEm: fc.constantFrom(0, 1.5, 3),
  },
  { requiredKeys: ['runs'] },
);
const options = fc.record({
  maxWidth: fc.integer({ min: 0, max: 200 }),
  spacing: fc.constantFrom<'collapse' | 'add'>('collapse', 'add'),
  align: fc.constantFrom('left', 'center', 'right', 'justify'),
});

describe('layoutStyled (ADR-0056 item 3, M20.12)', () => {
  it('FR-TXT-002: wrapStyled is the projection of layoutStyled, and each line is its pieces side by side', () => {
    fc.assert(
      fc.property(fc.array(block, { maxLength: 5 }), options, (blocks, opts) => {
        const laid = layoutStyled(blocks, base, measurer, opts);
        const wrapped = wrapStyled(blocks, base, measurer, opts);
        expect(laid.lines.map((l) => l.text)).toEqual(wrapped.lines);
        expect([laid.width, laid.height]).toEqual([wrapped.width, wrapped.height]);
        let bottom = 0;
        for (const line of laid.lines) {
          // lines stack top to bottom, each baseline inside its line
          expect(line.top).toBeGreaterThanOrEqual(bottom - 1e-9);
          expect(line.baseline).toBeGreaterThan(line.top);
          expect(line.baseline).toBeLessThanOrEqual(line.top + line.height + 1e-9);
          bottom = line.top + line.height;
          expect(line.pieces.map((p) => p.text).join('')).toBe(line.text);
          let x = line.x;
          for (const p of line.pieces) {
            expect(p.x).toBeCloseTo(x, 9);
            x += p.width;
          }
          expect(x - line.x).toBeCloseTo(line.width, 9);
        }
        expect(bottom).toBeLessThanOrEqual(laid.height + 1e-9);
      }),
    );
  });

  it('FR-TXT-002: a line sits in its width by the alignment, after its indent, at its baseline', () => {
    const blocks: StyledBlock[] = [{ runs: [{ text: 'ab ' }, { text: 'cd', weight: 700 }] }, { runs: [{ text: 'x' }], indentEm: 1.5, before: 4 }];
    const at = (align: string) => layoutStyled(blocks, base, measurer, { maxWidth: 100, align }).lines;
    const [first, second] = at('left');
    // 'ab ' at 5 px a character, then the bold piece; one line of 15 px (10 px at 1.5) with its baseline at half the leading plus the ascent
    expect(first?.pieces).toEqual([
      { text: 'ab ', font: { ...base, weight: 400, style: 'normal' }, x: 0, width: 15 },
      { text: 'cd', font: { ...base, weight: 700, style: 'normal' }, x: 15, width: 11 },
    ]);
    expect([first?.top, first?.height, first?.baseline]).toEqual([0, 15, 2.5 + 8]);
    // the second block's indent is 1.5 times the base size; its space above follows the first line
    expect([second?.x, second?.top]).toEqual([15, 19]);
    expect(at('center')[0]?.x).toBe((100 - 26) / 2);
    expect(at('right')[0]?.x).toBe(100 - 26);
    expect(at('center')[1]?.x).toBe(15 + (85 - 5) / 2);
    expect(at('justify')[0]?.x).toBe(0);
  });
});
