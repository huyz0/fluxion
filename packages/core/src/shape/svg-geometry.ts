import { identity, type Mat2d, multiply } from '@fluxion/geometry';
import type { SvgArtworkNode } from '@fluxion/schema';
import { svgPathExtent } from './svg-path.js';
import { svgNumberList, svgTransform } from './svg-transform.js';
import { svgViewport } from './svg-viewport.js';

const LENGTH = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?(?:px|cm|mm|q|in|pt|pc|em|ex|ch|rem|vw|vh|vmin|vmax|%)?$/i;
const LENGTH_FIELDS = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'width',
  'height',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'textLength',
  'stroke-width',
  'stroke-dashoffset',
  'font-size',
  'letter-spacing',
]);
const NONNEGATIVE = new Set([
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'markerWidth',
  'markerHeight',
  'textLength',
  'pathLength',
  'stroke-width',
  'stroke-miterlimit',
]);
const NUMBER_FIELDS = new Set(['pathLength', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset', 'stroke-miterlimit']);
const UNITS = new Set(['gradientUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits']);

function lengths(value: string): number[] | undefined {
  const parts = value.trim().split(/[\s,]+/);
  if (!parts.length || parts.some((part) => !LENGTH.test(part))) return undefined;
  const numbers = parts.map((part) => Number.parseFloat(part));
  return numbers.every(Number.isFinite) ? numbers : undefined;
}

function pathNumbers(value: string): number[] | undefined {
  const extent = svgPathExtent(value);
  return extent === undefined ? undefined : [extent];
}
function points(value: string): number[] | undefined {
  const list = svgNumberList(value);
  if (!list) return undefined;
  return list.length % 2 === 0 ? list : undefined;
}
function viewport(value: string): number[] | undefined {
  const list = svgNumberList(value);
  if (list?.length !== 4) return undefined;
  const [x = 0, y = 0, width = 0, height = 0] = list;
  if (width < 0 || height < 0) return undefined;
  const arithmetic = [x + width, y + height, width === 0 ? 0 : 1 / width, height === 0 ? 0 : 1 / height];
  return arithmetic.every(Number.isFinite) ? list : undefined;
}
function dashArray(value: string): number[] | undefined {
  if (value === 'none') return [];
  const list = lengths(value);
  return list?.every((n) => n >= 0) ? list : undefined;
}
const SPECIAL: Readonly<Record<string, (value: string) => number[] | undefined>> = {
  d: pathNumbers,
  points,
  viewBox: viewport,
  dx: lengths,
  dy: lengths,
  'stroke-dasharray': dashArray,
};
function singleLength(key: string, value: string): number[] | undefined {
  if (key === 'letter-spacing' && value === 'normal') return [];
  if (key === 'font-size' && /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/.test(value)) return [];
  const list = lengths(value);
  return list?.length === 1 ? list : undefined;
}
function numericAttribute(node: SvgArtworkNode, key: string, value: string): number[] | undefined | null {
  const special = SPECIAL[key];
  if (special) return special(value);
  if ((node.name === 'text' || node.name === 'tspan') && (key === 'x' || key === 'y')) return lengths(value);
  if (NUMBER_FIELDS.has(key)) return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(value) ? [Number.parseFloat(value)] : undefined;
  return LENGTH_FIELDS.has(key) ? singleLength(key, value) : null;
}

function enumAttribute(key: string, value: string): boolean {
  if (UNITS.has(key)) return value === 'userSpaceOnUse' || value === 'objectBoundingBox';
  if (key === 'markerUnits') return value === 'userSpaceOnUse' || value === 'strokeWidth';
  if (key === 'spreadMethod') return ['pad', 'reflect', 'repeat'].includes(value);
  if (key === 'preserveAspectRatio') return /^(?:defer\s+)?(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value);
  if (key === 'orient')
    return (
      ['auto', 'auto-start-reverse'].includes(value) ||
      (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:deg|grad|rad|turn)?$/i.test(value) && Number.isFinite(Number.parseFloat(value)))
    );
  return true;
}

export type SvgGeometry = { readonly matrix: Mat2d; readonly extent: number };
function numericExtent(node: SvgArtworkNode, key: string, value: string): number | undefined {
  const numbers = numericAttribute(node, key, value);
  if (numbers === undefined || !enumAttribute(key, value)) return undefined;
  if (!numbers?.every((n) => Number.isFinite(n) && (!NONNEGATIVE.has(key) || n >= 0)) && numbers !== null) return undefined;
  // Implicit x/y positioning belongs to the composed matrix, not the local extent.
  if (positioned(node) && ['x', 'y'].includes(key)) return 0;
  return (numbers ?? []).reduce((extent, n) => Math.max(extent, Math.abs(n)), 0);
}

function positioned(node: SvgArtworkNode): boolean {
  return node.name === 'use' || node.name === 'svg';
}
function positionMatrix(node: SvgArtworkNode, attributes: Readonly<Record<string, string>>): Mat2d {
  if (!positioned(node)) return identity();
  const { x = '0', y = '0' } = attributes;
  return [1, 0, 0, 1, Number.parseFloat(x), Number.parseFloat(y)];
}

/** Inspect complete numeric values, preserving SVG units for the renderer. */
export function svgGeometry(node: SvgArtworkNode, attributes: Readonly<Record<string, string>>): SvgGeometry | undefined {
  let matrix = identity();
  let extent = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'transform' || key === 'gradientTransform') {
      const parsed = svgTransform(value);
      if (!parsed) return undefined;
      matrix = parsed;
    } else {
      const parsed = numericExtent(node, key, value);
      if (parsed === undefined) return undefined;
      extent = Math.max(extent, parsed);
    }
  }
  const viewportMatrix = svgViewport(attributes);
  if (!viewportMatrix) return undefined;
  return { matrix: multiply(multiply(matrix, positionMatrix(node, attributes)), viewportMatrix), extent };
}
