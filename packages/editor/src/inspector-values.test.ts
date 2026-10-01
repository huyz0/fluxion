import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { clampTo, colorTokenRefs, isHex6, parseNumber, SCRUB_PX_PER_STEP, scrubbed, stepOf } from './inspector-values.js';

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
});
