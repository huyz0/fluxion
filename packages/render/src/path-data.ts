// SVG path data of a geometry path description (03 §5: outlines render as paths). Coordinates are
// rounded to 1/1000 px so the markup is stable across platforms (goldens, SSR parity).
import type { Path, PathCommand } from '@fluxion/geometry';

const n = (v: number) => String(Math.round(v * 1000) / 1000 || 0);
const pt = (p: { readonly x: number; readonly y: number }) => `${n(p.x)} ${n(p.y)}`;

/**
 * The SVG `d` attribute of `commands`.
 *
 * @public
 */
export function pathData(commands: readonly PathCommand[]): string {
  return commands
    .map((c) => {
      switch (
        c.kind // kind-switch-allow: a path command's closed union (geometry), not an element kind
      ) {
        case 'M':
          return `M${pt(c.to)}`;
        case 'L':
          return `L${pt(c.to)}`;
        case 'Q':
          return `Q${pt(c.control)} ${pt(c.to)}`;
        case 'C':
          return `C${pt(c.control1)} ${pt(c.control2)} ${pt(c.to)}`;
        default:
          return 'Z';
      }
    })
    .join(' ');
}

/**
 * The SVG `d` attribute of a normalized path (its cubics, closed with `Z` when it is closed).
 *
 * @public
 */
export function segmentsData(path: Path): string {
  const first = path.segments[0];
  if (first === undefined) return '';
  const cubics = path.segments.map((s) => `C${pt(s.p1)} ${pt(s.p2)} ${pt(s.p3)}`);
  return [`M${pt(first.p0)}`, ...cubics, ...(path.closed ? ['Z'] : [])].join(' ');
}
