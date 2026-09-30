// Shape definitions and registries for the editor's hit-testing tests: the basic pack's rectangle
// and line as it defines them, and outlines built to probe one rule each. No routers: connectors
// draw straight.
import { createRegistry, type ShapeDef } from '@fluxion/core';
import type { RouteContext } from '@fluxion/routing';

/** `basic:rect` and `basic:line` as packs/basic defines them. */
export const RECT: ShapeDef = { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } };
export const LINE: ShapeDef = { id: 'basic:line', outline: { path: 'M 0 {h/2} L {w} {h/2}' }, defaultSize: { w: 160, h: 16 } };
/** An outline no expression can evaluate: hit as its box. */
export const BROKEN: ShapeDef = { id: 'test:broken', outline: { path: 'M 0 0 L {nope} 0 Z' }, defaultSize: { w: 10, h: 10 } };
/** A right triangle, its right angle at the top-left: flips move it. */
export const TRIANGLE: ShapeDef = { id: 'test:triangle', outline: { path: 'M 0 0 L {w} 0 L 0 {h} Z' }, defaultSize: { w: 100, h: 100 } };
/** A notch cut up into the bottom edge: a concave corner at the box's centre. */
export const NOTCHED: ShapeDef = { id: 'test:notched', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L {w/2} {h/2} L 0 {h} Z' }, defaultSize: { w: 200, h: 200 } };
/** A rectangle whose label sits in its bottom-right quarter. */
export const INSET: ShapeDef = { ...RECT, id: 'test:inset', textRegions: [{ name: 'body', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] };
/** A rectangle whose definition leaves it unfilled. */
export const FRAME: ShapeDef = { ...RECT, id: 'test:frame', defaultStyle: { fill: 'transparent' } };

export function registries(): RouteContext {
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  for (const def of [RECT, LINE, BROKEN, TRIANGLE, FRAME, NOTCHED, INSET]) shapeDefs.register(def.id, def, 'test');
  // no routers: every connector draws straight
  return { shapeDefs, routers: createRegistry('routers') };
}
