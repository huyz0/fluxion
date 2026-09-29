// Marker definitions (FR-CON-003): the shape drawn at a connector end, as data. Render draws the
// built-ins and packs add their own (`<namespace>:<name>`); both register in a `markers` registry.

/**
 * A connector end marker: a path in a 10 x 10 box whose tip is at (10, 5), pointing along +x. It is
 * sized in stroke widths, so it scales with the connector's stroke.
 *
 * @public
 */
export type MarkerDef = {
  /** Marker id: a schema built-in (`arrow`, `triangle`, …) or `<namespace>:<name>`. */
  readonly id: string;
  /** SVG path data in the 10 x 10 box. */
  readonly path: string;
  /** How far back from the tip the route stops, in box units (0: at the tip; 10: the box's back). */
  readonly inset: number;
  /** Filled with the stroke colour; otherwise stroked as wide as the connector (an open marker). */
  readonly filled: boolean;
};
