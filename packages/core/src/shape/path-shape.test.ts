import { pointInPaths } from '@fluxion/geometry';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';
import { CORE_PATH_DEF, CORE_PATH_ID, ownPath, ownPathOf } from './path-shape.js';

const ring = { d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z', w: 10, h: 10, fillRule: 'evenodd' as const };

describe('core:path (ADR-0053, M19.41)', () => {
  it('FR-SHP-010: the path shape is built in, its definition the box with basic:rect side anchors', () => {
    const b = documentBuilder({ seed: 41 });
    b.screen();
    const core = createCore(b.build());
    expect(core.registries.shapeDefs.get(CORE_PATH_ID)).toBe(CORE_PATH_DEF);
    expect(CORE_PATH_DEF.anchors).toBeUndefined();
    expect(CORE_PATH_DEF.defaultSize).toEqual({ w: 100, h: 100 });
  });

  it('FR-SHP-010: scales d from its w × h box to the element box, every subpath kept, the outline the largest', () => {
    const own = ownPath(ring, { w: 100, h: 50 });
    expect(own?.fillRule).toBe('evenodd');
    expect(own?.paths).toHaveLength(2);
    expect(own?.commands[1]).toEqual({ kind: 'L', to: { x: 100, y: 0 } });
    expect(own?.outline).toBe(own?.paths[0]);
    expect(own?.outline.segments.at(1)?.p3).toEqual({ x: 100, y: 50 });
    // the hole is open under evenodd
    expect(pointInPaths(own?.paths ?? [], { x: 50, y: 25 }, own?.fillRule)).toBe(false);
    expect(pointInPaths(own?.paths ?? [], { x: 10, y: 5 }, own?.fillRule)).toBe(true);
  });

  it('FR-SHP-011: scales a curve’s control points and fills nonzero by default', () => {
    const own = ownPath({ d: 'M 0 0 Q 2 4 4 0 C 3 -1 1 -1 0 0 Z', w: 4, h: 4 }, { w: 8, h: 2 });
    expect(own?.fillRule).toBe('nonzero');
    expect(own?.commands[1]).toEqual({ kind: 'Q', control: { x: 4, y: 2 }, to: { x: 8, y: 0 } });
    expect(own?.commands[2]).toEqual({ kind: 'C', control1: { x: 6, y: -0.5 }, control2: { x: 2, y: -0.5 }, to: { x: 0, y: 0 } });
  });

  it('FR-SHP-010: data that does not read, or a reference box of no area, has no outline', () => {
    expect(ownPath({ d: 'M 0 0 A 1 1 0 0 1 2 2', w: 4, h: 4 }, { w: 4, h: 4 })).toBeUndefined();
    expect(ownPath({ d: 'M 0 0 L 4 4', w: 0, h: 4 }, { w: 4, h: 4 })).toBeUndefined();
  });

  it('FR-SHP-010: the same path and size give the same outline object (a drag redraws it many times)', () => {
    expect(ownPath(ring, { w: 20, h: 20 })).toBe(ownPath(ring, { w: 20, h: 20 }));
    expect(ownPath(ring, { w: 20, h: 20 })).not.toBe(ownPath(ring, { w: 30, h: 20 }));
  });

  it('FR-SHP-010: only a core:path element draws its path: on another definition it is ignored (ADR-0054)', () => {
    expect(ownPathOf({ defId: CORE_PATH_ID, path: ring }, { w: 10, h: 10 })).toBeDefined();
    expect(ownPathOf({ defId: 'basic:rect', path: ring }, { w: 10, h: 10 })).toBeUndefined();
    expect(ownPathOf({ defId: CORE_PATH_ID }, { w: 10, h: 10 })).toBeUndefined();
  });
});
