// SVG path data of a geometry path description (03 §5: outlines render as paths). Coordinates are
// rounded to 1/1000 px so the markup is stable across platforms (goldens, SSR parity).
import type { PathCommand } from '@fluxion/geometry';

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
