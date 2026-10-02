import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import {
  clampTo,
  colorTokenRefs,
  gradientCss,
  isHex6,
  optionGlyph,
  paintKind,
  paintLabel,
  parseNumber,
  SCRUB_PX_PER_STEP,
  scrubbed,
  stepOf,
  stepped,
} from './inspector-values.js';

const unit = { min: 0, max: 1 };

describe('inspector values (FR-EDT-008)', () => {
  it('FR-EDT-008: a number stays within the bounds the schema gives, and a missing bound does not limit', () => {
    expect([clampTo(unit, 2), clampTo(unit, -1), clampTo(unit, 0.4)]).toEqual([1, 0, 0.4]);
    expect([clampTo({}, -1e9), clampTo({ min: 0 }, 1e9), clampTo({ max: 5 }, -1e9)]).toEqual([-1e9, 1e9, -1e9]);
  });

  it('FR-EDT-008: a field bounded within about 0..1 steps by a hundredth, any other by one', () => {
    expect([stepOf(unit), stepOf({ min: 0, max: 2 }), stepOf({ min: 0, max: 3 }), stepOf({}), stepOf({ min: 0 }), stepOf({ max: 1 })]).toEqual([
      0.01, 0.01, 1, 1, 1, 1,
    ]);
  });

  it('FR-EDT-008: scrubbing moves one step per 4 px, ten times as fast with coarse and a tenth with fine, within bounds', () => {
    expect(SCRUB_PX_PER_STEP).toBe(4);
    expect(scrubbed({}, 10, 8)).toBe(12);
    expect(scrubbed({}, 10, -8)).toBe(8);
    expect(scrubbed({}, 10, 8, { coarse: true })).toBe(30);
    expect(scrubbed({}, 10, 8, { fine: true })).toBe(10.2);
    expect(scrubbed(unit, 0.5, 4)).toBe(0.51);
    expect(scrubbed(unit, 0.5, 4000)).toBe(1);
    expect(scrubbed(unit, 0.5, -4000)).toBe(0);
    // no float dust: 0.1 + 0.2 reads 0.3
    expect(scrubbed(unit, 0.1, 80)).toBe(0.3);
    expect(scrubbed({ min: 0 }, 3, -400)).toBe(0);
  });

  it('FR-EDT-008: typed numbers parse; empty clears; text that is no number is refused', () => {
    expect(parseNumber({}, '42')).toBe(42);
    expect(parseNumber({}, ' -3.5 ')).toBe(-3.5);
    expect(parseNumber(unit, '7')).toBe(1);
    expect(parseNumber({}, '')).toBeUndefined();
    expect(parseNumber({}, '   ')).toBeUndefined();
    expect(parseNumber({}, 'abc')).toBe('invalid');
    expect(parseNumber({}, 'Infinity')).toBe('invalid');
    expect(parseNumber({}, '1e3')).toBe(1000);
  });

  it('FR-EDT-008: the colour picker offers the theme`s colour tokens as references, in tree order', () => {
    const refs = colorTokenRefs(LIGHT_THEME);
    expect(refs.length).toBeGreaterThan(3);
    expect(refs).toContain('{color.primary}');
    for (const r of refs) expect(r).toMatch(/^\{color\.[\w.-]+\}$/);
    // a theme with no colours, and one with nested groups
    expect(colorTokenRefs({ ...LIGHT_THEME, tokens: {} } as never)).toEqual([]);
    const nested = {
      tokens: { color: { a: { $type: 'color', $value: '#fff' }, group: { b: { $type: 'color', $value: '#000' }, c: { $type: 'dimension', $value: '1px' } } } },
    };
    expect(colorTokenRefs(nested as never)).toEqual(['{color.a}', '{color.group.b}']);
  });

  it('FR-EDT-008: only a six-digit hex colour shows in the colour input', () => {
    expect([isHex6('#a1b2c3'), isHex6('#A1B2C3'), isHex6('#abc'), isHex6('red'), isHex6('{color.primary}'), isHex6(3), isHex6(undefined)]).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('FR-EDT-008: arrow keys step a number by one, ten with shift, a tenth with alt, within the bounds', () => {
    expect([stepped({}, 5, 1), stepped({}, 5, -1), stepped({}, 5, 1, { coarse: true }), stepped({}, 5, 1, { fine: true })]).toEqual([6, 4, 15, 5.1]);
    expect([stepped(unit, 0.5, 1), stepped(unit, 1, 1), stepped(unit, 0, -1)]).toEqual([0.51, 1, 0]);
  });

  it('FR-EDT-008: an enum option has an icon, a first letter when it has none', () => {
    expect([optionGlyph('left'), optionGlyph('grow'), optionGlyph('zigzag'), optionGlyph('')]).toEqual(['⇤', '⇱', 'Z', '·']);
  });

  it('FR-EDT-008: a gradient or image paint is told from a plain colour, and a gradient previews with its stops in order', () => {
    const g = {
      type: 'linear-gradient',
      angle: 0,
      stops: [
        { offset: 1, color: '#0000ff' },
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '{color.primary}' },
      ],
    };
    expect([
      paintKind(g),
      paintKind({ type: 'radial-gradient', stops: [] }),
      paintKind({ type: 'image' }),
      paintKind('#fff'),
      paintKind(undefined),
      paintKind(null),
    ]).toEqual(['gradient', 'gradient', 'image', undefined, undefined, undefined]);
    expect([paintLabel(g), paintLabel({ type: 'radial-gradient', stops: [] }), paintLabel({ type: 'image' }), paintLabel('#fff')]).toEqual([
      'linear gradient',
      'radial gradient',
      'image',
      undefined,
    ]);
    expect(gradientCss(g)).toBe('linear-gradient(90deg, #ff0000 0%, #888888 50%, #0000ff 100%)');
    expect(
      gradientCss({
        type: 'radial-gradient',
        stops: [
          { offset: 0, color: '#fff' },
          { offset: 1, color: '#000' },
        ],
      }),
    ).toBe('radial-gradient(#fff 0%, #000 100%)');
    expect([gradientCss({ type: 'linear-gradient', stops: [{ offset: 0, color: '#fff' }] }), gradientCss({ type: 'image' }), gradientCss('#fff')]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
