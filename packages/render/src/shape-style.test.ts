import type { ShapeElement } from '@fluxion/schema';
import { LIGHT_THEME, type Theme } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { outlineOf, shapeStyle, viewStyle } from './shape-style.js';
import { testShapeDefs } from './test-shapes.js';

// M18.288 (NFR-PERF-002): a big screen draws many shapes of one definition at one size; each outline is evaluated once per
// definition, size and params, and shapes with no style of their own share one resolved style per definition and theme
const def = testShapeDefs().get('basic:rect');
if (def === undefined) throw new Error('no basic:rect');
const shape = (id: string, extra: Partial<ShapeElement> = {}) =>
  ({ id, kind: 'shape', defId: 'basic:rect', transform: { x: 0, y: 0, w: 100, h: 50, rot: 0 }, ...extra }) as unknown as ShapeElement;

describe('shared shape outlines and styles (NFR-PERF-002, FR-SHP-001)', () => {
  it('an outline is evaluated once per definition, size and params, and another size or params gets its own', () => {
    const first = outlineOf(def, { w: 100, h: 50 }, undefined);
    expect(first.ok).toBe(true);
    expect(outlineOf(def, { w: 100, h: 50 }, {})).toBe(first);
    expect(outlineOf(def, { w: 100, h: 50 }, undefined)).toBe(first);
    const wider = outlineOf(def, { w: 160, h: 50 }, undefined);
    expect(wider).not.toBe(first);
    expect(outlineOf(def, { w: 160, h: 50 }, undefined)).toBe(wider);
    expect(outlineOf(def, { w: 100, h: 50 }, { radius: 4 })).not.toBe(first);
  });

  it('unstyled shapes of one definition and theme share their style; an own style or another theme resolves its own', () => {
    const a = viewStyle(shape('a'), def, LIGHT_THEME);
    expect(viewStyle(shape('b'), def, LIGHT_THEME)).toBe(a);
    expect(a).toEqual(shapeStyle(shape('a'), def, LIGHT_THEME).style);
    const red = viewStyle(shape('c', { style: { fill: '#ff0000' } } as Partial<ShapeElement>), def, LIGHT_THEME);
    expect(red).not.toBe(a);
    expect(red.fill).not.toEqual(a.fill);
    const other: Theme = { ...LIGHT_THEME };
    const themed = viewStyle(shape('a'), def, other);
    expect(themed).not.toBe(a);
    expect(viewStyle(shape('b'), def, other)).toBe(themed);
  });
});
