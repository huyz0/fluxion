// The basic pack's connector end markers (FR-CON-003): an open arrowhead and the ER crow's-foot
// cardinalities, drawn as strokes as wide as the connector. Each lies in the 10 x 10 marker box with
// its tip at (10, 5), where the entity is; a marker with a ring at its back stops the route there and
// draws its own line on to the tip, so the line does not cross the ring.
import type { MarkerDef } from '@fluxion/sdk';

/**
 * The pack's markers, namespace `basic`.
 *
 * @public
 */
export const basicMarkers: readonly MarkerDef[] = [
  // an open arrowhead: the line runs to its tip; the vertex sits half a unit back, so the stroke's bevel
  // (about 0.45 units beyond it at this angle) ends at the tip (M5.36 review F1)
  { id: 'basic:open-arrow', path: 'M0 0 L9.5 5 L0 10', inset: 0, filled: false },
  // exactly one: two bars across the line
  { id: 'basic:crows-foot-one', path: 'M5 0 L5 10 M8 0 L8 10', inset: 0, filled: false },
  // one or many: a crow's foot opening onto the entity, with a bar
  { id: 'basic:crows-foot-many', path: 'M4 5 L10 0 M4 5 L10 10 M2 0 L2 10', inset: 0, filled: false },
  // zero or one: a ring, then a bar
  { id: 'basic:crows-foot-zero-one', path: 'M0 5 A2 2 0 1 1 4 5 A2 2 0 1 1 0 5 M4 5 L10 5 M7 0 L7 10', inset: 10, filled: false },
  // zero or many: a ring, then a crow's foot
  { id: 'basic:crows-foot-zero-many', path: 'M0 5 A2 2 0 1 1 4 5 A2 2 0 1 1 0 5 M4 5 L10 5 M6 5 L10 0 M6 5 L10 10', inset: 10, filled: false },
];
