// Types for polybooljs 1.2.2 (MIT, ships none): the subset boolean.ts calls (ADR-0053).
declare module 'polybooljs' {
  /** A polygon: its rings as point lists, filled under the even-odd rule (inverted: the plane outside them). */
  export type Polygon = { regions: number[][][]; inverted: boolean };
  type PolyBool = {
    union(a: Polygon, b: Polygon): Polygon;
    intersect(a: Polygon, b: Polygon): Polygon;
    difference(a: Polygon, b: Polygon): Polygon;
    xor(a: Polygon, b: Polygon): Polygon;
  };
  const polybool: PolyBool;
  // biome-ignore lint/style/noDefaultExport: polybooljs is CommonJS: its module.exports is the default import
  export default polybool;
}
