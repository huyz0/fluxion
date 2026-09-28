// The `basic:rect` outline (FR-SHP-001), a built-in of R0 until the basic pack (M5).
import type { PathCommand } from '@fluxion/geometry';
import type { ShapeOutline } from './registries.js';

/**
 * The `basic:rect` outline: the box itself, clockwise from the top-left corner.
 *
 * @public
 */
export const BASIC_RECT: ShapeOutline = {
  outline: ({ w, h }): readonly PathCommand[] => [
    { kind: 'M', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: w, y: 0 } },
    { kind: 'L', to: { x: w, y: h } },
    { kind: 'L', to: { x: 0, y: h } },
    { kind: 'Z' },
  ],
};
