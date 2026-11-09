// FR-LIB-004 / NFR-SEC-001: every attribute svg-geometry classifies is checked by name, so a field dropped
// from one of its tables (or a unit from its length pattern) changes a verdict a test reads.
import { describe, expect, it } from 'vitest';
import { svgGeometry } from './svg-geometry.js';

const node = (name: string) => ({ name, attributes: {}, children: [] });
const extent = (attributes: Record<string, string>, name = 'rect') => svgGeometry(node(name), attributes)?.extent;

const LENGTHS = [
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
];
const NONNEGATIVE_LENGTHS = ['r', 'rx', 'ry', 'width', 'height', 'markerWidth', 'markerHeight', 'textLength', 'stroke-width'];
const NUMBERS = ['pathLength', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset', 'stroke-miterlimit'];
const UNIT_KEYS = ['gradientUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits'];
const UNITS = ['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'ex', 'ch', 'rem', 'vw', 'vh', 'vmin', 'vmax', '%'];

describe('FR-LIB-004 NFR-SEC-001: svgGeometry checks each attribute it knows by name', () => {
  it.each(LENGTHS)('FR-LIB-004: %s is a length: 12 measures 12, and a non-length is refused', (key) => {
    expect(extent({ [key]: '12' })).toBe(12);
    expect(extent({ [key]: 'twelve' })).toBeUndefined();
  });

  it('NFR-SEC-001: an attribute it does not know is not measured, whatever its value', () => {
    expect(extent({ fill: 'twelve' })).toBe(0);
    expect(extent({ 'data-anything': '-5px' })).toBe(0);
  });

  it.each(NONNEGATIVE_LENGTHS)('NFR-SEC-001: %s refuses a negative length', (key) => {
    expect(extent({ [key]: '-1' })).toBeUndefined();
  });

  it.each(LENGTHS.filter((k) => !NONNEGATIVE_LENGTHS.includes(k)))('FR-LIB-004: %s takes a negative length', (key) => {
    expect(extent({ [key]: '-3' })).toBe(3);
  });

  it.each(NUMBERS)('FR-LIB-004: %s is a plain number: 0.5 is kept, a length unit is refused', (key) => {
    expect(extent({ [key]: '0.5' })).toBe(0.5);
    expect(extent({ [key]: '5px' })).toBeUndefined();
  });

  it.each(['pathLength', 'stroke-miterlimit'])('NFR-SEC-001: %s refuses a negative number', (key) => {
    expect(extent({ [key]: '-1' })).toBeUndefined();
  });

  it.each(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset'])('FR-LIB-004: %s takes a negative number', (key) => {
    expect(extent({ [key]: '-1' })).toBe(1);
  });

  it.each(UNIT_KEYS)('NFR-SEC-001: %s takes only the two SVG unit keywords', (key) => {
    expect(extent({ [key]: 'userSpaceOnUse' })).toBe(0);
    expect(extent({ [key]: 'objectBoundingBox' })).toBe(0);
    expect(extent({ [key]: 'strokeWidth' })).toBeUndefined();
  });

  it.each(UNITS)('FR-LIB-004: a length in %s is accepted; an unknown unit is refused', (unit) => {
    expect(extent({ width: `7${unit}` })).toBe(7);
    expect(extent({ width: `7${unit}x` })).toBeUndefined();
  });
});

const geometry = (attributes: Record<string, string>, name = 'rect') => svgGeometry(node(name), attributes);

describe('FR-LIB-004 NFR-SEC-001: svgGeometry reads each value shape exactly', () => {
  it('FR-LIB-004: a length takes a sign, a fraction, an exponent and a unit in any case', () => {
    for (const [value, measured] of [
      ['+12', 12],
      ['12.5', 12.5],
      ['12.', 12],
      ['12.55', 12.55],
      ['.25', 0.25],
      ['1e2', 100],
      ['1e+2', 100],
      ['1e-2', 0.01],
      ['1e10', 1e10],
      ['7PX', 7],
    ] as const)
      expect(extent({ x: value }), value).toBe(measured);
  });

  it('NFR-SEC-001: a length is refused when anything comes before or after the number', () => {
    for (const value of ['1x2', '12x', 'x12', '', '1e', '1 2']) expect(extent({ x: value }), value).toBeUndefined();
  });

  it('FR-LIB-004: dx and dy take a trimmed list split on spaces and commas, and measure its largest', () => {
    expect(extent({ dx: ' 1, -4  2 ' })).toBe(4);
    expect(extent({ dy: '1 5' })).toBe(5);
    expect(extent({ dx: '1,  2' })).toBe(2);
    expect(extent({ dx: '5abc' })).toBeUndefined();
    expect(extent({ dx: '5 6abc' })).toBeUndefined();
    expect(extent({ dx: '1 1e999' })).toBeUndefined();
  });

  it('FR-LIB-004: a non-finite length is refused', () => {
    expect(extent({ x: '1e999' })).toBeUndefined();
  });

  it('FR-LIB-004: d is measured by its path, and an unreadable path is refused', () => {
    expect(extent({ d: 'M0 0L10 20' })).toBeGreaterThan(0);
    expect(extent({ d: 'nonsense' })).toBeUndefined();
  });

  it('FR-LIB-004: points come in pairs', () => {
    expect(extent({ points: '1 2 3 4' }, 'polygon')).toBe(4);
    expect(extent({ points: '1 2 3' }, 'polygon')).toBeUndefined();
    expect(extent({ points: 'x' }, 'polygon')).toBeUndefined();
  });

  it('FR-LIB-004: viewBox takes four numbers with a non-negative size', () => {
    expect(extent({ viewBox: '0 0 10 20' }, 'svg')).toBe(20);
    expect(extent({ viewBox: '0 0 0 5' }, 'svg')).toBe(5);
    expect(extent({ viewBox: '0 0 5 0' }, 'svg')).toBe(5);
    expect(extent({ viewBox: '0 0 10' }, 'svg')).toBeUndefined();
    expect(extent({ viewBox: '0 0 -1 5' }, 'svg')).toBeUndefined();
    expect(extent({ viewBox: '0 0 5 -1' }, 'svg')).toBeUndefined();
  });

  it('NFR-SEC-001: viewBox is refused when its far corner or its inverse size overflows', () => {
    expect(extent({ viewBox: '1e308 0 1e308 1' }, 'svg')).toBeUndefined();
    expect(extent({ viewBox: '0 1e308 1 1e308' }, 'svg')).toBeUndefined();
    expect(extent({ viewBox: '0 0 1e-320 1' }, 'svg')).toBeUndefined();
    expect(extent({ viewBox: '0 0 1 1e-320' }, 'svg')).toBeUndefined();
  });

  it('FR-LIB-004: stroke-dasharray takes none or non-negative lengths', () => {
    expect(extent({ 'stroke-dasharray': 'none' })).toBe(0);
    expect(extent({ 'stroke-dasharray': '1 2' })).toBe(2);
    expect(extent({ 'stroke-dasharray': '1 -2' })).toBeUndefined();
    expect(extent({ 'stroke-dasharray': 'x' })).toBeUndefined();
  });

  it('FR-LIB-004: letter-spacing normal and font-size keywords measure nothing, only on their own key', () => {
    expect(extent({ 'letter-spacing': 'normal' })).toBe(0);
    expect(extent({ 'font-size': 'large' })).toBe(0);
    expect(extent({ 'font-size': 'xx-small' })).toBe(0);
    expect(extent({ x: 'normal' })).toBeUndefined();
    expect(extent({ x: 'large' })).toBeUndefined();
    expect(extent({ 'font-size': 'normal' })).toBeUndefined();
  });

  it('FR-LIB-004: a single length field refuses a list', () => {
    expect(extent({ width: '1 2' })).toBeUndefined();
  });

  it('FR-LIB-004: text and tspan take a list for x and y, other elements and fields do not', () => {
    expect(extent({ x: '1 2 3' }, 'text')).toBe(3);
    expect(extent({ y: '1 -4' }, 'tspan')).toBe(4);
    expect(extent({ x: '1 2' }, 'rect')).toBeUndefined();
    expect(extent({ width: '1 2' }, 'text')).toBeUndefined();
  });

  it('FR-LIB-004: a plain number takes a percent and a trailing point', () => {
    expect(extent({ opacity: '50%' })).toBe(50);
    expect(extent({ opacity: '1.' })).toBe(1);
  });

  it('NFR-SEC-001: enumerated attributes take only their keywords', () => {
    for (const [key, good, bad] of [
      ['markerUnits', 'strokeWidth', 'objectBoundingBox'],
      ['markerUnits', 'userSpaceOnUse', 'pad'],
      ['spreadMethod', 'reflect', 'mirror'],
      ['spreadMethod', 'pad', 'userSpaceOnUse'],
      ['spreadMethod', 'repeat', ''],
      ['orient', 'auto', 'sideways'],
      ['orient', 'auto-start-reverse', '45px'],
      ['orient', '45deg', '1e999'],
    ] as const) {
      expect(extent({ [key]: good }), `${key}=${good}`).toBe(0);
      expect(extent({ [key]: bad }), `${key}=${bad}`).toBeUndefined();
    }
    expect(extent({ preserveAspectRatio: 'xMidYMid meet' }, 'svg')).toBe(0);
    expect(extent({ preserveAspectRatio: 'none' }, 'svg')).toBe(0);
    expect(extent({ preserveAspectRatio: 'bogus' }, 'svg')).toBeUndefined();
  });

  it('FR-LIB-004: a zero length is kept where negatives are refused', () => {
    expect(extent({ width: '0' })).toBe(0);
    expect(extent({ width: '0', x: '3' })).toBe(3);
  });

  it('FR-LIB-004: use and svg place x and y in the matrix, other elements measure them', () => {
    expect(geometry({ x: '5', y: '7' }, 'use')).toEqual({ matrix: [1, 0, 0, 1, 5, 7], extent: 0 });
    expect(geometry({ x: '5', y: '7' }, 'svg')).toEqual({ matrix: [1, 0, 0, 1, 5, 7], extent: 0 });
    expect(geometry({}, 'use')).toEqual({ matrix: [1, 0, 0, 1, 0, 0], extent: 0 });
    expect(geometry({ x: '5', y: '-7' }, 'rect')).toEqual({ matrix: [1, 0, 0, 1, 0, 0], extent: 7 });
    expect(geometry({ width: '9' }, 'use')?.extent).toBe(9);
  });

  it('FR-LIB-004: transform and gradientTransform set the matrix, and an unreadable one is refused', () => {
    expect(geometry({ transform: 'translate(3 4)' })?.matrix).toEqual([1, 0, 0, 1, 3, 4]);
    expect(geometry({ gradientTransform: 'translate(3 4)' })?.matrix).toEqual([1, 0, 0, 1, 3, 4]);
    expect(geometry({ transform: 'bogus' })).toBeUndefined();
    expect(geometry({ gradientTransform: 'bogus' })).toBeUndefined();
  });

  it('FR-LIB-004: the extent is the largest over all attributes, in any order', () => {
    expect(extent({ x: '3', width: '9' })).toBe(9);
    expect(extent({ width: '9', x: '3' })).toBe(9);
    expect(extent({ width: '9', x: 'bad' })).toBeUndefined();
  });

  it('FR-LIB-004: the viewport fit joins the matrix', () => {
    expect(geometry({ viewBox: '0 0 10 10', width: '20', height: '20' }, 'svg')?.matrix).toEqual([2, 0, 0, 2, 0, 0]);
  });
});
