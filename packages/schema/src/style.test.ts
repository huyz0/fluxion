import { describe, expect, it } from 'vitest';
import { styleSchema, transformSchema } from './style.js';

describe('style and transform values', () => {
  it('FR-SHP-001: a full style validates and round-trips unchanged', () => {
    const style = {
      fill: {
        type: 'linear-gradient',
        angle: 45,
        stops: [
          { offset: 0, color: '{color.a}' },
          { offset: 1, color: '#fff' },
        ],
      },
      stroke: { color: '#000', width: 2, dash: [4, 2], cap: 'round', join: 'bevel' },
      opacity: 0.8,
      radius: '{radius.md}',
      shadow: [{ x: 0, y: 2, blur: 8, color: 'rgb(0 0 0 / 20%)' }],
      effects: [{ type: 'glow', radius: 6, color: '{color.accent}' }],
      font: {
        family: '{font.body}',
        size: 18,
        weight: 600,
        style: 'italic',
        lineHeight: 1.4,
        letterSpacing: -0.2,
        color: '#222',
        align: 'center',
        verticalAlign: 'middle',
      },
      variant: 'emphasis',
    };
    expect(styleSchema.parse(style)).toEqual(style);
  });

  it('FR-DOC-004: an invalid token ref "{color" yields one issue at its path', () => {
    const r = styleSchema.safeParse({ fill: '{color', stroke: { color: '#000' } });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('/'))).toEqual(['fill']);
  });

  it('rejects out-of-range numbers and unknown enum values', () => {
    for (const bad of [
      { opacity: 1.5 },
      { radius: -1 },
      { stroke: { width: -2 } },
      { stroke: { cap: 'pointy' } },
      { shadow: [{ x: 0, y: 0, blur: -1, color: '#000' }] },
      { effects: [{ type: 'sparkle', radius: 1 }] },
      { font: { weight: 0 } },
      { font: { size: 0 } },
      { font: { family: '' } },
      { variant: '' },
    ])
      expect(styleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('FR-SHP-001: a transform has x, y, w, h and rotation (default 0) and optional flips', () => {
    expect(transformSchema.parse({ x: 10, y: 20, w: 100, h: 50 })).toEqual({ x: 10, y: 20, w: 100, h: 50, rot: 0 });
    expect(transformSchema.parse({ x: 0, y: 0, w: 0, h: 0, rot: -45, flipX: true })).toMatchObject({ rot: -45, flipX: true });
    for (const bad of [
      { x: 0, y: 0, w: -1, h: 1 },
      { x: 0, y: 0, w: 1 },
      { x: Number.NaN, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1, rot: Number.POSITIVE_INFINITY },
    ])
      expect(transformSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('FR-DOC-005: keeps unknown keys in style, font and transform', () => {
    const parsed = styleSchema.parse({ blend: 'multiply', font: { features: ['liga'] } });
    expect(parsed['blend']).toBe('multiply');
    expect(parsed.font?.['features']).toEqual(['liga']);
    expect(transformSchema.parse({ x: 0, y: 0, w: 1, h: 1, skew: 3 })['skew']).toBe(3);
  });
});
