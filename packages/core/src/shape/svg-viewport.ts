import { identity, type Mat2d } from '@fluxion/geometry';
import { svgNumberList } from './svg-transform.js';

/** The authored numeric viewport fit; surrounding relative-unit resolution remains the host's. */
export function svgViewport(attributes: Readonly<Record<string, string>>): Mat2d | undefined {
  const { viewBox, width, height, preserveAspectRatio } = attributes;
  if (viewBox === undefined) return identity();
  const box = svgNumberList(viewBox);
  if (box?.length !== 4) return undefined;
  const [x = 0, y = 0, w = 0, h = 0] = box;
  if (w === 0 || h === 0) return identity(); // SVG suppresses painting for a zero viewport extent.
  const sx = (width === undefined ? w : Number.parseFloat(width)) / w;
  const sy = (height === undefined ? h : Number.parseFloat(height)) / h;
  const aspect = preserveAspectRatio ?? 'xMidYMid meet';
  const scale = aspect.endsWith('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
  const [a, d] = aspect === 'none' ? [sx, sy] : [scale, scale];
  // Include alignment's full spare-space extent conservatively, regardless of min/mid/max.
  const e = Math.abs(x * a) + Math.abs((sx - a) * w);
  const f = Math.abs(y * d) + Math.abs((sy - d) * h);
  const matrix: Mat2d = [a, 0, 0, d, e, f];
  return matrix.every(Number.isFinite) ? matrix : undefined;
}
