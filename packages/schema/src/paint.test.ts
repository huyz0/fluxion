import { describe, expect, it } from 'vitest';
import { colorSchema, colorValueSchema, paintSchema, tokenRefSchema } from './paint.js';

describe('paint values', () => {
  it('FR-SCR-001: token references are {dot.separated} names', () => {
    for (const ok of ['{color}', '{color.primary}', '{space.2-x_l}']) expect(tokenRefSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['{color', 'color}', '{}', '{a..b}', '{a b}', 7]) expect(tokenRefSchema.safeParse(bad).success, String(bad)).toBe(false);
  });

  it('accepts literal colours and rejects other strings', () => {
    const good = ['#fff', '#ffff', '#a1b2c3', '#a1b2c3d4', 'rgb(1 2 3)', 'hsl(10 20% 30%)', 'oklch(0.5 0.1 20)', 'transparent', 'rebeccapurple'];
    const alsoGood = [
      'CurrentColor',
      'Navy',
      'RGB(1, 2, 3)',
      'rgba(1,2,3,.5)',
      'oklch(0.5 0.1 20 / 50%)',
      'color(display-p3 1 0 0)',
      'hsl(none 0% 50%)',
      'hwb(90deg 10% 10%)',
    ];
    for (const ok of [...good, ...alsoGood]) expect(colorValueSchema.safeParse(ok).success, ok).toBe(true);
    const bad = [
      '#ff',
      '#ggg',
      'url(x)',
      'rgb(1 2 3',
      'Red Blue',
      '',
      'banana',
      'javascript',
      'rgb(banana)',
      'color()',
      'hsl(;x:y)',
      'rgb(1 2)',
      'rgb(1 2 3 4 5)',
      'color(display-p3)',
    ];
    for (const b of bad) expect(colorValueSchema.safeParse(b).success, b).toBe(false);
  });

  it('checks transformed tokens and gradient stops', () => {
    expect(colorValueSchema.safeParse({ token: '{color.a}', transform: { lighten: -0.2 } }).success).toBe(true);
    expect(colorValueSchema.safeParse({ token: '{color.a}', transform: { alpha: 2 } }).success).toBe(false);
    expect(
      paintSchema.safeParse({
        type: 'radial-gradient',
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1.5, color: '#fff' },
        ],
      }).success,
    ).toBe(false);
    expect(paintSchema.safeParse({ type: 'pattern' }).success).toBe(false);
  });

  // The regex anchors, channel parsing and messages are checked directly, so a loosened anchor or a
  // dropped filter changes a verdict here rather than only in a style test further downstream.
  const color = (v: string) => colorValueSchema.safeParse(v).success;

  it('FR-SCR-001: token references and literal colours are anchored at both ends', () => {
    for (const bad of ['x{a}', '{a}x', ' {a}']) expect(tokenRefSchema.safeParse(bad).success, bad).toBe(false);
    for (const bad of ['x#fff', 'xrgb(1 2 3)', 'rgb(1 2 3)x', 'rgb(x1 2 3)', 'rgb(1x 2 3)']) expect(color(bad), bad).toBe(false);
  });

  it('FR-SCR-001: channels are numbers with an optional sign, fraction, exponent and unit, or none', () => {
    for (const ok of ['rgb(+1 -2 3)', 'rgb(.55 1 2)', 'rgb(12.5 1 2)', 'rgb(1e5 2 3)', 'rgb(1e10 2 3)', 'rgb(1e+5 2e-3 3E2)', 'hsl(1turn 2% 3%)'])
      expect(color(ok), ok).toBe(true);
    for (const bad of ['rgb(1 2 x)', 'rgb(none none foo)', 'rgb(1e 2 3)', 'rgb(1 2 3px)', 'rgb(. 2 3)']) expect(color(bad), bad).toBe(false);
  });

  it('FR-SCR-001: surrounding space and empty separators do not count as channels', () => {
    for (const ok of [' rgb(1 2 3) ', 'rgb( 1 2 3)', 'rgb(1 2 3 )', 'rgb(1, 2 , 3)', 'rgb(1 2 3 / 50%)']) expect(color(ok), ok).toBe(true);
  });

  it('FR-SCR-001: a color() colour space is a name starting with a letter, anchored at both ends', () => {
    for (const ok of ['color(srgb 1 0 0)', 'color(display-p3 1 0 0 / 0.5)', 'color(xyz-d65 0.1 0.2 0.3)']) expect(color(ok), ok).toBe(true);
    for (const bad of ['color(1display 1 0 0)', 'color(p3% 1 0 0)', 'color(-p3 1 0 0)']) expect(color(bad), bad).toBe(false);
  });

  it('reports what a token reference and a colour must look like', () => {
    const token = tokenRefSchema.safeParse('nope');
    expect(token.success).toBe(false);
    expect(token.error?.issues[0]?.message).toBe('expected a token reference such as "{color.primary}"');
    const literal = colorSchema.safeParse('nope');
    expect(literal.success).toBe(false);
    expect(literal.error?.issues[0]?.message).toBe('expected a CSS colour (#hex, a colour function or a named colour)');
  });
});
