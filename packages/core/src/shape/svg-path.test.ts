// FR-LIB-004 / NFR-SEC-001: the path reader's extent is read back for each command, origin, implicit
// repeat, reflection rule and bound, so a dropped arity, origin or rule changes a verdict here.
import { SVG_POLICY_LIMITS } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { svgPathExtent } from './svg-path.js';

describe('svgPathExtent', () => {
  it.each([
    ['', 0],
    ['  M1 2  ', 2],
    ['M0 0 L3 -4', 4],
    ['M1 1 L2 2', 2],
    ['m1 1 l2 2', 3],
    ['M1 1 2 2', 2],
    ['m1 1 2 2', 3],
    ['M1 2 H5', 5],
    ['M1 2 h5', 6],
    ['M1 2 V7', 7],
    ['M1 2 v7', 9],
    ['M0 0 H1 2 3', 3],
    ['M0 9 H1 l0 1', 10],
    ['M9 0 V1 l1 0', 10],
    ['M0 0 A1 1 0 0 1 5 6', 6],
    ['M10 10 a1 1 0 0 1 5 6', 16],
    ['M0 0 A1 1 0 0 1 2 3 l0 10', 13],
    ['M0 0 A1 1 0 11 2 3', 3],
    ['M0 0 C0 0 -5 -5 5 5 S6 6 6 6', 15],
    ['M0 0 C0 0 -5 -5 5 5 s1 1 1 1', 15],
    ['M0 0 Q-5 -5 5 5 T6 6', 15],
    ['M0 0 Q-5 -5 5 5 t1 1', 15],
    ['M0 0 Q-5 -5 5 5 S6 6 6 6', 6],
    ['M0 0 C-5 -5 -5 -5 5 5 T6 6', 6],
    ['M0 0 Q1 1 2 2 T3 3 T4 4', 4],
    ['M1 1 L9 9 Z l0 20', 21],
    ['M1 1 L9 9 z l0 20', 21],
    ['M1 1 L9 9 Z L0 0', 9],
    ['M1 1 Z M2 2', 2],
  ])('FR-LIB-004: %j measures %d', (path, extent) => {
    expect(svgPathExtent(path)).toBe(extent);
  });

  it.each([
    'L1 1',
    'Z',
    '1 1',
    'M0 0 X1',
    'M0 0 B1',
    'M1e999 0',
    'M0 0 L1e999 0',
    'M0 0 C1 2 3 4 5',
    'M0 0 S1 2 3',
    'M0 0 Q1 2 3',
    'M0 0 T1',
    'M0 0 A1 1 0 0 1 2',
    'M0 0 A1 1 0 2 1 2 3',
    'M0 0 H',
    'M0 0 V',
    'M0',
    'M0 0 Z 1 1',
    'M0 0 L1 x',
  ])('NFR-SEC-001: %j is refused', (path) => {
    expect(svgPathExtent(path)).toBeUndefined();
  });

  it('NFR-SEC-001: at most the node budget of segments is read', () => {
    const max = SVG_POLICY_LIMITS.maxNodes;
    expect(svgPathExtent(`M0 0${'L1 1'.repeat(max - 1)}`)).toBe(1);
    expect(svgPathExtent(`M0 0${'L1 1'.repeat(max)}`)).toBeUndefined();
  });
});
