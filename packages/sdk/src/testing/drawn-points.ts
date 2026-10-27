// The points a golden draws (ADR-0194): segment ends and curve midpoints of every outline and decoration path, in the shape's
// own box. Render writes absolute `M L Q C Z` path data (render's path-data.ts); anything else is reported, never skipped.

/** A point, or the reason a path could not be read. */
type Drawn = { readonly points: (readonly [number, number])[]; readonly unreadable: string[] };

const SIZES: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6 };

/** The point halfway along a quadratic or cubic from `at` through the controls and end in `c`. */
function middle(at: readonly [number, number], c: readonly number[]): readonly [number, number] {
  if (c.length === 4) {
    const [x1 = 0, y1 = 0, x = 0, y = 0] = c;
    return [(at[0] + 2 * x1 + x) / 4, (at[1] + 2 * y1 + y) / 4];
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = c;
  return [(at[0] + 3 * x1 + 3 * x2 + x) / 8, (at[1] + 3 * y1 + 3 * y2 + y) / 8];
}

/** One path's points; a command's numbers may repeat it. */
function pathPoints(d: string, out: Drawn): void {
  let at: readonly [number, number] = [0, 0];
  for (const [, op = '', args = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const size = SIZES[op];
    const n = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (op === 'Z') continue;
    if (size === undefined || n.length === 0 || n.length % size !== 0 || n.some((v) => !Number.isFinite(v))) {
      out.unreadable.push(`${op}${args}`.trim());
      continue;
    }
    for (let i = 0; i < n.length; i += size) {
      if (size > 2) out.points.push(middle(at, n.slice(i, i + size)));
      at = [n[i + size - 2] as number, n[i + size - 1] as number];
      out.points.push(at);
    }
  }
}

/** Every drawn point of a golden's outline and decoration paths, and any path data that could not be read. */
export function drawnPoints(svg: string): Drawn {
  const out: Drawn = { points: [], unreadable: [] };
  for (const [, d = ''] of svg.matchAll(/<path class="fx-(?:outline|decoration)" d="([^"]+)"/g)) pathPoints(d, out);
  return out;
}
