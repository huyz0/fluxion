import { describe, expect, it } from 'vitest';
import { colorValueSchema, paintSchema, tokenRefSchema } from './paint.js';

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
});
