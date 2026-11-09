import { describe, expect, it } from 'vitest';
import { describeFields } from './field-meta.js';
import { styleSchema, transformRotation, transformSchema } from './style.js';

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
      { variant: '{variant' },
      { font: { family: '{font.body' } },
    ])
      expect(styleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('FR-SHP-001: a transform has x, y, w, h, an optional rotation (read as 0) and optional flips', () => {
    const t = transformSchema.parse({ x: 10, y: 20, w: 100, h: 50 });
    expect(t).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(transformRotation(t)).toBe(0);
    expect(transformRotation({ rot: 30 })).toBe(30);
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

// Every inspector entry and enum value is checked by name, so a dropped label, section, order or
// keyword changes a verdict here.
describe('style fields, one by one', () => {
  it('FR-EDT-008: the style inspector shows exactly these fields, in this order', () => {
    expect(describeFields(styleSchema)).toEqual([
      { path: ['fill'], ui: 'paint', group: 'Fill', order: 1, label: 'Fill' },
      { path: ['stroke', 'color'], ui: 'paint', group: 'Stroke', order: 1, label: 'Colour' },
      { path: ['stroke', 'width'], ui: 'number', group: 'Stroke', order: 2, label: 'Width', min: 0 },
      { path: ['opacity'], ui: 'slider', group: 'Appearance', order: 1, label: 'Opacity', min: 0, max: 1 },
      { path: ['radius'], ui: 'number', group: 'Appearance', order: 2, label: 'Corner radius', min: 0 },
      { path: ['font', 'size'], ui: 'number', group: 'Text', order: 1, label: 'Size', min: 0 },
      { path: ['font', 'color'], ui: 'paint', group: 'Text', order: 2, label: 'Colour' },
      { path: ['font', 'align'], ui: 'select', group: 'Text', order: 3, label: 'Align', options: ['left', 'center', 'right', 'justify'] },
    ]);
  });

  it('FR-EDT-008: the transform inspector shows exactly these fields, in this order', () => {
    expect(describeFields(transformSchema)).toEqual([
      { path: ['x'], ui: 'number', group: 'Layout', order: 1, label: 'X' },
      { path: ['y'], ui: 'number', group: 'Layout', order: 2, label: 'Y' },
      { path: ['w'], ui: 'number', group: 'Layout', order: 3, label: 'Width', min: 0 },
      { path: ['h'], ui: 'number', group: 'Layout', order: 4, label: 'Height', min: 0 },
      { path: ['rot'], ui: 'number', group: 'Layout', order: 5, label: 'Rotation' },
      { path: ['flipX'], ui: 'toggle', group: 'Layout', order: 6, label: 'Flip horizontally' },
      { path: ['flipY'], ui: 'toggle', group: 'Layout', order: 7, label: 'Flip vertically' },
    ]);
  });

  it.each([
    ['stroke', 'cap', ['butt', 'round', 'square']],
    ['stroke', 'join', ['miter', 'round', 'bevel']],
    ['stroke', 'align', ['center', 'inside', 'outside']],
    ['font', 'style', ['normal', 'italic']],
    ['font', 'align', ['left', 'center', 'right', 'justify']],
    ['font', 'verticalAlign', ['top', 'middle', 'bottom']],
  ] as const)('FR-SHP-001: %s.%s takes exactly its keywords', (group, key, values) => {
    for (const value of values) expect(styleSchema.safeParse({ [group]: { [key]: value } }).success, value).toBe(true);
    for (const value of ['', 'other']) expect(styleSchema.safeParse({ [group]: { [key]: value } }).success, value).toBe(false);
  });

  it('FR-SHP-001: an effect is a glow or a blur', () => {
    for (const type of ['glow', 'blur']) expect(styleSchema.safeParse({ effects: [{ type, radius: 1 }] }).success, type).toBe(true);
    for (const type of ['', 'shadow']) expect(styleSchema.safeParse({ effects: [{ type, radius: 1 }] }).success, type).toBe(false);
  });

  it('FR-SHP-001: a literal name that starts with { is refused as a mistyped token reference', () => {
    expect(styleSchema.safeParse({ variant: 'primary' }).success).toBe(true);
    const result = styleSchema.safeParse({ variant: '{x' });
    expect(result.error?.issues.map((i) => i.message)).toEqual(['looks like a token reference but is not a valid one, e.g. "{font.body}"']);
    expect(styleSchema.safeParse({ variant: '' }).success).toBe(false);
  });
});
