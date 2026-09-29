// Shape definitions for render's own tests: render ships none (ADR-0016 item 7), so its tests register
// a rectangle identical to the basic pack's, which the M4 goldens were drawn with. No view imports here:
// node tests use it in the coverage sandbox, which leaves browser-covered sources out.
import { createRegistry, type Registry, type ShapeDef } from '@fluxion/core';

/** `basic:rect` as packs/basic defines it: the box, clockwise from the top-left corner. */
export const TEST_RECT: ShapeDef = { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } };

/** A shapeDefs registry holding {@link TEST_RECT}. */
export function testShapeDefs(): Registry<string, ShapeDef> {
  const registry = createRegistry<string, ShapeDef>('shapeDefs');
  registry.register(TEST_RECT.id, TEST_RECT, 'test');
  return registry;
}
