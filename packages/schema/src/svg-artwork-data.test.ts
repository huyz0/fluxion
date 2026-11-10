import { describe, expect, it } from 'vitest';
import { isSvgArtworkData } from './svg-artwork-data.js';
import { SVG_POLICY_LIMITS } from './svg-policy.js';

// Each guard of the structural artwork check is exercised directly, so a dropped or loosened guard
// changes a verdict here rather than only in a pack or import test further downstream.
const node = (name: string, children: unknown[] = [], attributes: object = {}) => ({ name, attributes, children });
const art = (root: unknown, extra: object = {}) => ({ viewBox: { x: 0, y: 0, width: 10, height: 10 }, root, ...extra });
const chain = (depth: number, leaf: unknown[] = []) => {
  let root = node('g', leaf);
  for (let i = 1; i < depth; i++) root = node('g', [root]);
  return root;
};

describe('isSvgArtworkData (NFR-SEC-001, FR-LIB-004)', () => {
  it('FR-LIB-004: accepts plain artwork with text children, null-prototype records and token colours', () => {
    expect(isSvgArtworkData(art(node('svg', [node('text', ['hi', 'there'], { x: '1' })])))).toBe(true);
    const attributes = Object.assign(Object.create(null), { fill: 'red' });
    expect(isSvgArtworkData(art(node('path', [], attributes)))).toBe(true);
    expect(isSvgArtworkData(art(node('g'), { colors: { '#ff0000': '{color.a}', red: '{color.a.b-c_d}' } }))).toBe(true);
  });

  it('NFR-SEC-001: text children sit at their parent depth, so a 64-deep chain may end in text', () => {
    expect(isSvgArtworkData(art(chain(SVG_POLICY_LIMITS.maxDepth, ['leaf'])))).toBe(true);
    expect(isSvgArtworkData(art(chain(SVG_POLICY_LIMITS.maxDepth + 1)))).toBe(false);
  });

  it('NFR-SEC-001: refuses records with another prototype, symbol keys, accessors or prototype-pollution keys', () => {
    class Attributes {
      fill = 'red';
    }
    const symbolic = { fill: 'red', [Symbol('s')]: 'x' };
    const accessor = Object.defineProperty({}, 'fill', { get: () => 'red', enumerable: true });
    const hidden = Object.defineProperty({}, 'fill', { value: 'red', enumerable: false });
    for (const attributes of [new Attributes(), symbolic, accessor, hidden, JSON.parse('{"__proto__":"x"}'), { constructor: 'x' }, { prototype: 'x' }])
      expect(isSvgArtworkData(art(node('g', [], attributes)))).toBe(false);
  });

  it('NFR-SEC-001: refuses arrays with another prototype, extra keys or holes', () => {
    class Children extends Array {}
    const custom = Object.setPrototypeOf(['a'], Children.prototype);
    const extra = Object.assign(['a'], { more: 1 });
    // biome-ignore lint/suspicious/noSparseArray: a hole is the case under test
    const holes = ['a', , 'b'];
    for (const children of [custom, extra, holes]) expect(isSvgArtworkData(art(node('g', children)))).toBe(false);
  });

  it('NFR-SEC-001: refuses a value reached twice and a record wider than the node budget allows', () => {
    const shared = { fill: 'red' };
    expect(isSvgArtworkData(art(node('g', [node('a', [], shared), node('b', [], shared)])))).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: SVG_POLICY_LIMITS.maxNodes * 2 + 1 }, (_, i) => [`k${i}`, '']));
    expect(isSvgArtworkData(art(node('g', [], wide)))).toBe(false);
  });

  it('NFR-SEC-001: the record, value and node budgets admit artwork well inside them', () => {
    const wide = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`k${i}`, '']));
    expect(isSvgArtworkData(art(node('g', [], wide)))).toBe(true);
    const many = node(
      'g',
      Array.from({ length: 3000 }, () => node('path', [], { d: 'M0 0' })),
    );
    expect(isSvgArtworkData(art(many))).toBe(true);
  });

  it('NFR-SEC-001: strings and keys count toward the character budget, inclusive of its limit', () => {
    const fixed = ['viewBox', 'x', 'y', 'width', 'height', 'root', 'name', 'g', 'attributes', 'd', 'children'].join('').length;
    const at = (chars: number) => art(node('g', [], { d: 'x'.repeat(chars - fixed) }));
    expect(isSvgArtworkData(at(SVG_POLICY_LIMITS.maxChars))).toBe(true);
    expect(isSvgArtworkData(at(SVG_POLICY_LIMITS.maxChars + 1))).toBe(false);
  });

  it('FR-LIB-004: a node is a string name, string attributes and an array of children, nothing else', () => {
    for (const root of [
      { name: 1, attributes: {}, children: [] },
      { name: 'g', attributes: { fill: 1 }, children: [] },
      { name: 'g', attributes: [], children: [] },
      { name: 'g', attributes: {}, children: {} },
      { name: 'g', attributes: {}, children: [], extra: 1 },
      { attributes: {}, children: [] },
      node('g', [node('a', [], { fill: 2 })]),
    ])
      expect(isSvgArtworkData(art(root)), JSON.stringify(root)).toBe(false);
  });

  it('FR-LIB-004: the viewBox is four finite numbers with a positive size', () => {
    const view = (viewBox: object) => isSvgArtworkData({ viewBox, root: node('g') });
    expect(view({ x: -5, y: 2.5, width: 0.1, height: 1 })).toBe(true);
    for (const viewBox of [
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
      { x: 0, y: 0, width: -1, height: 1 },
      { x: 0, y: 0, width: 1, height: -1 },
      { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
      { x: '0', y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1 },
      { x: 0, y: 0, width: 1, height: 1, z: 0 },
    ])
      expect(view(viewBox), JSON.stringify(viewBox)).toBe(false);
  });

  it('FR-LIB-004: colours map a CSS colour to a token reference anchored at both ends', () => {
    for (const colors of [{ red: 'x{a}' }, { red: '{a}x' }, { red: '{}' }, { red: 1 }, { nope: '{a}' }, ['{a}']])
      expect(isSvgArtworkData(art(node('g'), { colors })), JSON.stringify(colors)).toBe(false);
    expect(isSvgArtworkData(art(node('g'), { extra: 1 }))).toBe(false);
    for (const input of [null, 'svg', 1, [art(node('g'))]]) expect(isSvgArtworkData(input), JSON.stringify(input)).toBe(false);
  });
});
