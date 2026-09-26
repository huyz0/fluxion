export interface Point {
  readonly x: number;
}
export function firstX(points: readonly Point[]): number | undefined {
  return points[0]?.x;
}
