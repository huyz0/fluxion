import { describe, expect, it } from 'vitest';
import { parseShapeDef, type ShapeDef } from './shape-def.js';

const star: ShapeDef = {
  id: 'basic:star',
  params: {
    points: { type: 'int', min: 3, max: 64, default: 5 },
    inner: { type: 'number', min: 0.1, max: 0.9, default: 0.5 },
    tip: { type: 'enum', values: ['sharp', 'round'], default: 'sharp' },
  },
  outline: { polygon: { n: '2 * points', x: 'w/2 + (i % 2 ? inner : 1) * w/2 * sin(2*pi*i/n)', y: 'h/2 - (i % 2 ? inner : 1) * h/2 * cos(2*pi*i/n)' } },
  anchors: [{ name: 'top', x: 0.5, y: 0 }],
  textRegions: [{ name: 'body', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }],
  handles: [{ param: 'inner', x: 'w/2', y: 'h/2 - inner * h/2' }],
  defaultSize: { w: 100, h: 100 },
  defaultStyle: { strokeWidth: 2 },
  decorations: [{ path: 'M 0 {h/2} L {w} {h/2}' }],
  keywords: ['star'],
  category: 'basic',
  license: 'MIT',
};

const problems = (input: unknown) => {
  const r = parseShapeDef(input, ['defs', 0]);
  return r.ok ? [] : r.error.map((d) => `${d.code} ${d.path} ${d.message}`);
};

describe('shape definitions (ADR-0016, 03 §5)', () => {
  it('FR-SHP-003: a complete definition validates unchanged', () => {
    const r = parseShapeDef(star);
    expect(r.ok ? r.value : r.error).toEqual(star);
    const polyline: ShapeDef = {
      id: 'basic:polyline',
      params: {
        vertices: {
          type: 'points',
          min: 2,
          max: 100,
          default: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      outline: { points: 'vertices', closed: false, smooth: false },
      defaultSize: { w: 100, h: 40 },
    };
    expect(parseShapeDef(polyline).ok).toBe(true);
    expect(parseShapeDef({ id: 'basic:line', outline: { path: 'M 0 0 L {w} {h}' }, defaultSize: { w: 1, h: 1 } }).ok).toBe(true);
  });

  it('FR-SHP-003: an inconsistent definition is a diagnostic at the field it names', () => {
    const base = { id: 'x:y', outline: { path: 'M 0 0' }, defaultSize: { w: 1, h: 1 } };
    const withParams = (params: unknown) => problems({ ...base, params });
    expect(withParams({ w: { type: 'number', default: 1 } })).toEqual([
      'FLX_SHAPE_DEF_INVALID /defs/0/params/w param name "w" must be an identifier other than w, h, i, n and pi',
    ]);
    for (const name of ['h', 'i', 'n', 'pi', '1x', 'a-b', '']) expect(withParams({ [name]: { type: 'number', default: 1 } }), name).toHaveLength(1);
    expect(withParams({ _ok9: { type: 'number', default: 1 } })).toEqual([]);
    expect(withParams({ r: { type: 'number', min: 0, max: 10, default: 11 } })).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/params/r default is outside 0 … 10']);
    expect(withParams({ r: { type: 'number', min: 0, default: -1 } })).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/params/r default is outside 0 … …']);
    expect(withParams({ r: { type: 'int', max: 3, default: 4 } })).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/params/r default is outside … … 3']);
    expect(withParams({ r: { type: 'number', min: 0, max: 10, default: 0 } })).toEqual([]);
    expect(withParams({ r: { type: 'number', min: 0, max: 10, default: 10 } })).toEqual([]);
    expect(withParams({ r: { type: 'number', min: 5, max: 4, default: 4 } })).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/params/r min 5 is greater than max 4']);
    expect(withParams({ r: { type: 'number', min: 4, max: 4, default: 4 } })).toEqual([]);
    expect(withParams({ e: { type: 'enum', values: ['a', 'b'], default: 'c' } })).toEqual([
      'FLX_SHAPE_DEF_INVALID /defs/0/params/e default "c" is not one of the values',
    ]);
    expect(withParams({ e: { type: 'enum', values: ['a', 'a'], default: 'a' } })).toEqual([
      'FLX_SHAPE_DEF_INVALID /defs/0/params/e enum values must be unique',
    ]);
    expect(
      withParams({
        p: {
          type: 'points',
          min: 3,
          default: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    ).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/params/p default is outside 3 … …']);
    expect(
      withParams({
        p: {
          type: 'points',
          max: 2,
          default: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    ).toEqual([]);
    const triangle = [
      [0, 0],
      [1, 1],
      [0, 1],
    ];
    expect(withParams({ p: { type: 'points', default: triangle } })).toEqual([]);
    expect(withParams({ p: { type: 'points', default: [[0, 0]] } })).toHaveLength(1);
    expect(
      withParams({
        p: {
          type: 'points',
          default: [
            [0, 0],
            [1, 1.5],
          ],
        },
      }),
    ).toHaveLength(1);
    expect(withParams({ r: { type: 'number', default: 1, step: 2 } })).toHaveLength(1);
    // the params an outline or a handle names must exist with the right type
    expect(problems({ ...base, outline: { points: 'p' } })).toEqual(['FLX_SHAPE_DEF_INVALID /defs/0/outline/points "p" is not a points param']);
    expect(problems({ ...base, params: { p: { type: 'number', default: 1 } }, outline: { points: 'p' } })).toHaveLength(1);
    expect(problems({ ...base, params: { e: { type: 'enum', values: ['a'], default: 'a' } }, handles: [{ param: 'e', x: '0', y: '0' }] })).toEqual([
      'FLX_SHAPE_DEF_INVALID /defs/0/handles/0/param "e" is not a number or int param',
    ]);
    expect(problems({ ...base, handles: [{ param: 'q', x: '0', y: '0' }] })).toHaveLength(1);
    expect(problems({ ...base, params: { k: { type: 'int', default: 1 } }, handles: [{ param: 'k', x: '0', y: '0' }] })).toEqual([]);
    // one outline kind, known fields, a qualified id, a positive size
    expect(problems({ ...base, outline: { path: 'M 0 0', polygon: { n: '3', x: '0', y: '0' } } })).not.toEqual([]);
    expect(problems({ ...base, colour: 'red' })).not.toEqual([]);
    expect(problems({ ...base, id: 'star' })[0]).toMatch(/^FLX_SHAPE_DEF_INVALID \/defs\/0\/id /);
    expect(problems({ ...base, defaultSize: { w: 0, h: 1 } })[0]).toMatch(/^FLX_SHAPE_DEF_INVALID \/defs\/0\/defaultSize\/w /);
    expect(parseShapeDef(null).ok).toBe(false);
    const bare = parseShapeDef({ ...base, id: 'star' });
    expect(bare.ok ? '' : bare.error[0]?.path).toBe('/id');
  });
});
