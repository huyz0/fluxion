import { identity, type Mat2d, multiply, rotation, scaling, translate } from '@fluxion/geometry';
import { SvgNumbers } from './svg-numbers.js';

const ARITIES: Readonly<Record<string, readonly number[]>> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
function rotate(args: readonly number[]): Mat2d {
  const [a = 0, x = 0, y = 0] = args;
  const r = rotation((a * Math.PI) / 180);
  return args.length === 1 ? r : multiply(translate(x, y), multiply(r, translate(-x, -y)));
}
function matrix(name: string, args: number[]): Mat2d | undefined {
  if (!ARITIES[name]?.includes(args.length)) return undefined;
  const [a = 0, b = 0] = args;
  switch (name) {
    case 'matrix':
      return args as unknown as Mat2d;
    case 'translate':
      return translate(a, b);
    case 'scale':
      return scaling(a, args[1] ?? a);
    case 'rotate':
      return rotate(args);
    case 'skewX':
      return [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    case 'skewY':
      return [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    default:
      return undefined;
  }
}

/** A complete comma/whitespace-separated SVG numeric list. */
export function svgNumberList(source: string): number[] | undefined {
  const scanner = new SvgNumbers(source);
  const result: number[] = [];
  scanner.space();
  while (scanner.at < source.length) {
    if (result.length && !/[\t\n\r ,]/.test(source[scanner.at] ?? '')) return undefined;
    const value = scanner.number({ first: result.length === 0 });
    if (value === undefined) return undefined;
    result.push(value);
    const before = scanner.at;
    scanner.space();
    if (scanner.at === source.length) break;
    scanner.at = before;
  }
  return result;
}

function firstTransform(source: string): { matrix: Mat2d; rest: string } | undefined {
  const match = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/.exec(source);
  if (!match) return undefined;
  const args = svgNumberList(match[2] ?? '');
  const next = args ? matrix(match[1] ?? '', args) : undefined;
  if (!next) return undefined;
  let rest = source.slice(match[0].length).trimStart();
  if (rest.startsWith(',')) {
    rest = rest.slice(1).trimStart();
    if (!rest) return undefined;
  }
  return { matrix: next, rest };
}
/** SVG transform list, including the finite product, or undefined for invalid geometry. */
export function svgTransform(source: string): Mat2d | undefined {
  let rest = source.trim();
  let result = identity();
  if (rest === 'none') return result;
  while (rest.length) {
    const part = firstTransform(rest);
    if (!part) return undefined;
    result = multiply(result, part.matrix);
    if (!result.every(Number.isFinite)) return undefined;
    rest = part.rest;
  }
  return result;
}
