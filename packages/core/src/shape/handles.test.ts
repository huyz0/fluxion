import { describe, expect, it } from 'vitest';
import { handleValue, shapeHandles } from './handles.js';
import type { ShapeDef } from './shape-def.js';

const box = { outline: { path: 'M 0 0 L {w} 0 L {w} {h} Z' }, defaultSize: { w: 100, h: 100 } };
/** A rounded rectangle's handle: on the top edge at the corner radius, which the box caps at half the shorter side. */
const rounded: ShapeDef = {
  ...box,
  id: 'test:rounded',
  params: { r: { type: 'number', min: 0, max: 1000, default: 12 } },
  handles: [{ param: 'r', x: 'min(r, w/2, h/2)', y: '0' }],
};
const size = { w: 160, h: 100 };

describe('shape handles (FR-SHP-003)', () => {
  it('FR-SHP-003: a handle is placed by its expressions for the element`s size and params', () => {
    expect(shapeHandles({ def: rounded, size })).toEqual([{ index: 0, param: 'r', at: { x: 12, y: 0 } }]);
    expect(shapeHandles({ def: rounded, size, params: { r: 30 } })).toEqual([{ index: 0, param: 'r', at: { x: 30, y: 0 } }]);
    // capped by half the shorter side; a value outside the param's range is clamped like the outline`s
    expect(shapeHandles({ def: rounded, size, params: { r: 90 } })[0]?.at).toEqual({ x: 50, y: 0 });
    expect(shapeHandles({ def: rounded, size: { w: 20, h: 100 }, params: { r: 90 } })[0]?.at).toEqual({ x: 10, y: 0 });
    // no handles, or a handle whose expression fails, are left out
    expect(shapeHandles({ def: { ...box, id: 'test:none' }, size })).toEqual([]);
    const two: ShapeDef = {
      ...rounded,
      handles: [
        { param: 'r', x: '1 / (r - r)', y: '0' },
        { param: 'r', x: 'r', y: 'h' },
      ],
    };
    expect(shapeHandles({ def: two, size, params: { r: 5 } })).toEqual([{ index: 1, param: 'r', at: { x: 5, y: 100 } }]);
    // a failing y alone also drops the handle
    expect(shapeHandles({ def: { ...rounded, handles: [{ param: 'r', x: 'r', y: '1 / (r - r)' }] }, size })).toEqual([]);
  });

  it('FR-SHP-003: the value for a pointer is the param that puts the handle nearest it', () => {
    expect(handleValue({ def: rounded, size }, 0, { x: 30, y: 0 })).toBeCloseTo(30, 2);
    expect(handleValue({ def: rounded, size }, 0, { x: 12, y: 0 })).toBeCloseTo(12, 2);
    // off the edge the handle runs along: the nearest point of it
    expect(handleValue({ def: rounded, size }, 0, { x: 44, y: 70 })).toBeCloseTo(44, 2);
    // before the start of the range: the minimum
    expect(handleValue({ def: rounded, size }, 0, { x: -50, y: 0 })).toBeCloseTo(0, 2);
    // beyond where the box caps it, the least value that reaches the cap (half the width is 80, the height`s half 50)
    expect(handleValue({ def: rounded, size }, 0, { x: 140, y: 0 })).toBeCloseTo(50, 0);
    // other params of the element are the element`s own
    const scaled: ShapeDef = {
      ...rounded,
      params: { r: { type: 'number', min: 0, max: 100, default: 10 }, k: { type: 'number', default: 1 } },
      handles: [{ param: 'r', x: 'r * k', y: '0' }],
    };
    expect(handleValue({ def: scaled, size, params: { k: 2 } }, 0, { x: 60, y: 0 })).toBeCloseTo(30, 2);
    expect(handleValue({ def: scaled, size }, 0, { x: 60, y: 0 })).toBeCloseTo(60, 2);
  });

  it('FR-SHP-003: an int param is whole, a number is rounded to a thousandth', () => {
    const steps: ShapeDef = {
      ...box,
      id: 'test:steps',
      params: { n: { type: 'int', min: 1, max: 12, default: 3 } },
      handles: [{ param: 'n', x: 'n * 10', y: '0' }],
    };
    expect(handleValue({ def: steps, size }, 0, { x: 34, y: 0 })).toBe(3);
    expect(handleValue({ def: steps, size }, 0, { x: 36, y: 0 })).toBe(4);
    expect(handleValue({ def: steps, size }, 0, { x: 1000, y: 0 })).toBe(12);
    expect(handleValue({ def: steps, size }, 0, { x: -1000, y: 0 })).toBe(1);
    const thousandths = handleValue({ def: rounded, size }, 0, { x: 33.33333, y: 0 }) as number;
    expect(thousandths).toBe(Math.round(thousandths * 1000) / 1000);
    expect(thousandths).toBeCloseTo(33.333, 2);
  });

  it('FR-SHP-003: a param without a range is searched from 0 (or its default if lower) to a few times its default or the box', () => {
    const open: ShapeDef = { ...box, id: 'test:open', params: { d: { type: 'number', default: 20 } }, handles: [{ param: 'd', x: 'd', y: '0' }] };
    expect(handleValue({ def: open, size: { w: 100, h: 100 } }, 0, { x: 60, y: 0 })).toBeCloseTo(60, 1);
    // up to the box when that is larger than 4 x the default: 160 wide
    expect(handleValue({ def: open, size: { w: 160, h: 100 } }, 0, { x: 150, y: 0 })).toBeCloseTo(150, 1);
    const negative: ShapeDef = { ...open, id: 'test:neg', params: { d: { type: 'number', default: -20 } } };
    expect(handleValue({ def: negative, size }, 0, { x: -15, y: 0 })).toBeCloseTo(-15, 1);
  });

  it('FR-SHP-003: no value where there is no handle, it names no number, or its expressions fail', () => {
    expect(handleValue({ def: rounded, size }, 1, { x: 0, y: 0 })).toBeUndefined();
    expect(handleValue({ def: { ...box, id: 'test:none' }, size }, 0, { x: 0, y: 0 })).toBeUndefined();
    const enumHandle: ShapeDef = { ...rounded, params: { r: { type: 'enum', values: ['a', 'b'], default: 'a' } } };
    expect(handleValue({ def: enumHandle, size }, 0, { x: 5, y: 0 })).toBeUndefined();
    const unknownParam: ShapeDef = { ...rounded, handles: [{ param: 'zzz', x: '1', y: '1' }] };
    expect(handleValue({ def: unknownParam, size }, 0, { x: 5, y: 0 })).toBeUndefined();
    const broken: ShapeDef = { ...rounded, handles: [{ param: 'r', x: '1 / (r - r)', y: '0' }] };
    expect(handleValue({ def: broken, size }, 0, { x: 5, y: 0 })).toBeUndefined();
    // a handle failing in part of the range still finds its best elsewhere
    const partial: ShapeDef = {
      ...rounded,
      params: { r: { type: 'number', min: 0, max: 100, default: 10 } },
      handles: [{ param: 'r', x: 'r', y: '1 / (r - 50)' }],
    };
    expect(handleValue({ def: partial, size }, 0, { x: 70, y: 1 })).toBeDefined();
  });
  it('FR-SHP-003: the pointer`s y counts as well as its x, the range is the param`s own, and a drag past its end sets the end', () => {
    // a handle that runs down the left edge
    const vertical: ShapeDef = {
      ...box,
      id: 'test:vertical',
      params: { d: { type: 'number', min: 10, max: 90, default: 20 } },
      handles: [{ param: 'd', x: '5', y: 'd' }],
    };
    const subject = { def: vertical, size };
    expect(handleValue(subject, 0, { x: 5, y: 40 })).toBeCloseTo(40, 2);
    expect(handleValue(subject, 0, { x: 300, y: 40 })).toBeCloseTo(40, 2);
    expect(handleValue(subject, 0, { x: 5, y: 55 })).toBeCloseTo(55, 2);
    // past either end of the range: the end (the range`s span is hi - lo, from lo)
    expect(handleValue(subject, 0, { x: 5, y: 500 })).toBeCloseTo(90, 2);
    expect(handleValue(subject, 0, { x: 5, y: -500 })).toBeCloseTo(10, 2);
    // an unbounded param in a small box: up to 4 x its default
    const open: ShapeDef = { ...vertical, id: 'test:open2', params: { d: { type: 'number', default: 20 } } };
    expect(handleValue({ def: open, size: { w: 10, h: 10 } }, 0, { x: 5, y: 70 })).toBeCloseTo(70, 1);
    expect(handleValue({ def: open, size: { w: 10, h: 10 } }, 0, { x: 5, y: 500 })).toBeCloseTo(80, 1);
  });
  it('FR-SHP-003: halfway between two whole values the lower is taken; a param with a minimum and no maximum reaches only its search range', () => {
    const steps: ShapeDef = {
      ...box,
      id: 'test:steps2',
      params: { n: { type: 'int', min: 1, max: 12, default: 3 } },
      handles: [{ param: 'n', x: 'n * 10', y: '0' }],
    };
    expect(handleValue({ def: steps, size }, 0, { x: 35, y: 0 })).toBe(3);
    const floor: ShapeDef = { ...box, id: 'test:floor', params: { d: { type: 'number', min: 10, default: 20 } }, handles: [{ param: 'd', x: '5', y: 'd' }] };
    expect(handleValue({ def: floor, size: { w: 10, h: 10 } }, 0, { x: 5, y: 500 })).toBeCloseTo(80, 1);
    expect(handleValue({ def: floor, size: { w: 10, h: 10 } }, 0, { x: 5, y: -500 })).toBeCloseTo(10, 1);
  });

  it('FR-SHP-003: a handle that runs through several valleys settles in the one nearest the best sample', () => {
    // x swings between 10 and 90 as the param turns: the pointer at 50 is reached at several values
    const swing: ShapeDef = {
      ...box,
      id: 'test:swing',
      params: { a: { type: 'number', min: 0, max: 20, default: 0 } },
      handles: [{ param: 'a', x: '50 + 40 * sin(a)', y: '0' }],
    };
    for (const x of [50, 20, 85, 12]) {
      const a = handleValue({ def: swing, size }, 0, { x, y: 0 }) as number;
      expect(50 + 40 * Math.sin(a), `x ${x}`).toBeCloseTo(x, 1);
    }
  });
});
