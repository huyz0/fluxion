import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { elementFields } from './element-fields.js';
import { describeFields } from './field-meta.js';

const paths = (kind: string) => elementFields(kind).map((f) => f.path.join('.'));

describe('field metadata (FR-EDT-008)', () => {
  it('FR-EDT-008: a schema lists the fields whose meta has a ui, nested ones with their path, sorted by section then order', () => {
    const schema = z.object({
      b: z.number().min(2).max(9).meta({ ui: 'slider', group: 'Two', order: 2, label: 'Bee' }).optional(),
      a: z.string().meta({ ui: 'text', group: 'One', order: 5 }),
      hidden: z.string(),
      deep: z.object({ c: z.enum(['x', 'y']).meta({ ui: 'select', group: 'One', order: 1 }).optional() }).optional(),
      tokenOrNumber: z.union([z.number().min(0), z.string()]).meta({ ui: 'number' }),
      leaf: z.object({ inside: z.string().meta({ ui: 'text' }) }).meta({ ui: 'paint', group: 'One', order: 9 }),
    });
    const fields = describeFields(schema);
    expect(fields.map((f) => f.path.join('.'))).toEqual(['b', 'deep.c', 'a', 'leaf', 'tokenOrNumber']);
    expect(fields[1]).toEqual({ path: ['deep', 'c'], ui: 'select', group: 'One', order: 1, label: 'c', options: ['x', 'y'] });
    expect(fields[0]).toEqual({ path: ['b'], ui: 'slider', group: 'Two', order: 2, label: 'Bee', min: 2, max: 9 });
    // no group: General, last order; the bounds of the number member of a union
    expect(fields[4]).toMatchObject({ group: 'General', order: 1000, label: 'tokenOrNumber', min: 0 });
    expect(fields[4]).not.toHaveProperty('max');
    // a leaf is not walked into
    expect(paths('shape')).not.toContain('leaf.inside');
  });

  it('FR-EDT-008: the element kinds mark their layout, appearance and own fields', () => {
    expect(paths('shape')).toEqual([
      'name',
      'hidden',
      'transform.x',
      'transform.y',
      'transform.w',
      'transform.h',
      'transform.rot',
      'transform.flipX',
      'transform.flipY',
      'style.fill',
      'style.stroke.color',
      'style.stroke.width',
      'style.opacity',
      'style.radius',
      'style.font.size',
      'style.font.color',
      'style.font.align',
      'textFit.mode',
      'textFit.padding',
    ]);
    expect(elementFields('shape').find((f) => f.path.join('.') === 'style.opacity')).toMatchObject({ ui: 'slider', min: 0, max: 1 });
    expect(paths('frame')).toEqual(expect.arrayContaining(['clip', 'padding']));
    expect(paths('text')).toContain('autoSize');
    expect(paths('image')).toContain('fit');
    expect(paths('connector')).toEqual(expect.arrayContaining(['name', 'hidden', 'style.stroke.color']));
    expect(paths('connector')).not.toContain('transform.x');
  });

  it('FR-EDT-008: a plugin kind has the plugin element`s fields, and a kind this version does not know none', () => {
    expect(paths('acme:gauge')).toContain('transform.x');
    expect(elementFields('hologram')).toEqual([]);
    expect(elementFields('unknown')).toEqual([]);
    expect(elementFields('plugin')).toEqual([]);
    expect(elementFields('constructor')).toEqual([]);
  });
});
