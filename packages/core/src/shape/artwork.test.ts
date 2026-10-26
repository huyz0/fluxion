import { describe, expect, it } from 'vitest';
import { parseShapeDef } from './shape-def.js';

const base = { id: 'test:artwork', outline: { path: 'M 0 0 L 100 0 L 100 100 Z' }, defaultSize: { w: 100, h: 100 } };
const node = (name: string, attributes: Record<string, string> = {}, children: unknown[] = []) => ({ name, attributes, children });
const artwork = (root: unknown) => ({ viewBox: { x: 0, y: 0, width: 100, height: 100 }, root });
const check = (root: unknown) => parseShapeDef({ ...base, artwork: artwork(root) });

describe('FR-LIB-004 NFR-SEC-001: checked imported artwork', () => {
  it('FR-LIB-004: retains a filled compound path and the independent routing outline', () => {
    const root = node('path', { d: 'M0 0H100V100H0Z M25 25h50v50h-50z', fill: '#ff0000', 'fill-rule': 'evenodd' });
    const parsed = check(root);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ ...base, artwork: artwork(root) });
  });
  it('FR-LIB-004: accepts local gradient and clipping references', () => {
    expect(
      check(
        node('g', {}, [
          node('defs', {}, [
            node('linearGradient', { id: 'paint' }, [
              node('stop', { offset: '0%', 'stop-color': 'red' }),
              node('stop', { offset: '100%', 'stop-color': 'blue' }),
            ]),
            node('clipPath', { id: 'clip' }, [node('circle', { cx: '50', cy: '50', r: '40' })]),
          ]),
          node('rect', { width: '100', height: '100', fill: 'url(#paint)', 'clip-path': 'url(#clip)' }),
        ]),
      ).ok,
    ).toBe(true);
  });
  it('NFR-SEC-001: rejects executable nodes, attributes and a mixed safe/unsafe style', () => {
    for (const root of [
      node('script', {}, ['alert(1)']),
      node('path', { d: 'M0 0L1 1', onload: 'alert(1)' }),
      node('rect', { width: '1', height: '1', style: 'fill:red;background:url(https://example.invalid/x)' }),
    ])
      expect(check(root).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects dangling, external and recursive references', () => {
    for (const root of [
      node('use', { href: '#missing' }),
      node('use', { href: 'https://example.invalid/x' }),
      node('g', { id: 'loop' }, [node('use', { href: '#loop' })]),
      node('defs', {}, [node('linearGradient', { id: 'a', href: '#b' }), node('linearGradient', { id: 'b', href: '#a' })]),
    ])
      expect(check(root).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects duplicate IDs and wrong-kind targets', () => {
    expect(check(node('g', {}, [node('rect', { id: 'x' }), node('circle', { id: 'x' })])).ok).toBe(false);
    expect(check(node('g', {}, [node('path', { id: 'x', d: 'M0 0L1 1' }), node('rect', { fill: 'url(#x)' })])).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects malformed paths and nonfinite geometry rather than rendering partial data', () => {
    for (const d of ['L1 2', 'M0 0 L1', 'M0 0A1 1 0 2 0 2 2', 'M0 0L1e999 1']) expect(check(node('path', { d })).ok).toBe(false);
    for (const transform of ['matrix(1 0 0 1 0)', 'scale(1e999)', 'translate(NaN)', 'rotate(1) trailing'])
      expect(check(node('g', { transform })).ok).toBe(false);
  });
  it('FR-LIB-004: accepts SVG2 negative and zero arc radii and compact arc flags', () => {
    for (const d of ['M0 0A-10 10 0 0 1 20 20', 'M0 0A0 10 0 0 1 20 20', 'M0 0A10 10 0 0120 20']) expect(check(node('path', { d })).ok).toBe(true);
  });
  it('NFR-SEC-001: rejects JS object cycles before recursive schema traversal', () => {
    const root = node('g');
    root.children.push(root);
    expect(() => check(root)).not.toThrow();
    expect(check(root).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects excessive tree depth before recursive schema traversal', () => {
    let root = node('rect', { width: '1', height: '1' });
    for (let i = 0; i < 1000; i++) root = node('g', {}, [root]);
    expect(() => check(root)).not.toThrow();
    expect(check(root).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects finite operands whose composed transforms overflow', () => {
    expect(check(node('g', { transform: 'scale(1e200)' }, [node('g', { transform: 'scale(1e200)' })])).ok).toBe(false);
  });
  it('FR-LIB-003: retains legacy definitions without artwork unchanged', () => {
    const parsed = parseShapeDef(base);
    expect(parsed.ok && parsed.value).toEqual(base);
  });
  it('NFR-SEC-001: style precedence cannot hide a dangling reference or nonfinite attribute', () => {
    expect(check(node('rect', { fill: 'url(#missing)', style: 'fill:red' })).ok).toBe(false);
    expect(check(node('rect', { 'stroke-width': '1e999', style: 'stroke-width:1' })).ok).toBe(false);
  });
  it('NFR-SEC-001: rejects accessors without invoking them, including nonenumerable fields', () => {
    let calls = 0;
    const raw = artwork(node('g'));
    Object.defineProperty(raw, 'root', {
      get: () => {
        calls++;
        return node('g');
      },
      enumerable: false,
    });
    expect(parseShapeDef({ ...base, artwork: raw }).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('NFR-SEC-001: viewport endpoints and reciprocal scales must stay finite', () => {
    for (const viewBox of [
      { x: 1e308, y: 0, width: 1e308, height: 1 },
      { x: 0, y: 0, width: 5e-324, height: 1 },
    ])
      expect(parseShapeDef({ ...base, artwork: { ...artwork(node('g')), viewBox } }).ok).toBe(false);
  });

  it.each([
    ['style geometry', node('rect', { transform: 'scale(1e200)', style: 'stroke-width:1e200' })],
    ['nested viewport', node('svg', { viewBox: '1e308 0 1e308 1' })],
  ])('NFR-SEC-001: %s arithmetic remains finite after composition', (_label, root) => {
    expect(check(root).ok).toBe(false);
  });
  it('NFR-SEC-001: the shared depth and node boundaries are exact', () => {
    let root = node('rect', { width: '1', height: '1' });
    for (let i = 1; i < 64; i++) root = node('g', {}, [root]);
    expect(check(root).ok).toBe(true);
    expect(check(node('g', {}, [root])).ok).toBe(false);
    expect(
      check(
        node(
          'text',
          {},
          Array.from({ length: 19_999 }, () => ''),
        ),
      ).ok,
    ).toBe(true);
    expect(
      check(
        node(
          'text',
          {},
          Array.from({ length: 20_000 }, () => ''),
        ),
      ).ok,
    ).toBe(false);
  });
  it('NFR-SEC-001: rejects aliases, foreign prototypes and oversized paint data', () => {
    const shared = node('rect', { width: '1', height: '1' });
    expect(check(node('g', {}, [shared, shared])).ok).toBe(false);
    expect(check(Object.assign(Object.create({ inherited: true }), node('g'))).ok).toBe(false);
    expect(check(node('text', {}, ['x'.repeat(2 * 1024 * 1024)])).ok).toBe(false);
  });
  it('NFR-SEC-001: bounds acyclic use expansion independently of stored nodes', () => {
    const definitions = [node('g', { id: 'n0' }, [node('rect', { width: '1', height: '1' })])];
    for (let i = 1; i < 16; i++) definitions.push(node('g', { id: `n${i}` }, [node('use', { href: `#n${i - 1}` }), node('use', { href: `#n${i - 1}` })]));
    expect(check(node('g', {}, [node('defs', {}, definitions), node('use', { href: '#n15' })])).ok).toBe(false);
  });
  it('FR-LIB-004: preserves complete SVG path and transform syntax', () => {
    for (const d of ['M1e1-2L3.5.5h4v-2zM0 0q1 2 3 4t5 6', 'm0 0c1 2 3 4 5 6s7 8 9 10a4 5 30 01-2-3z']) expect(check(node('path', { d })).ok).toBe(true);
    expect(check(node('g', { transform: 'translate(1,2) rotate(20 3 4) scale(2 -1) skewX(10) skewY(-5) matrix(1 0 0 1 2 3)' })).ok).toBe(true);
  });
});

it('NFR-SEC-001: explicit nested viewport fitting cannot overflow or hide a child overflow', () => {
  for (const root of [
    node('svg', { width: '1e308', height: '1', viewBox: '0 0 1e-308 1', preserveAspectRatio: 'none' }),
    node('svg', { width: '1e200', height: '1e200', viewBox: '0 0 1 1' }, [node('path', { d: 'M0 0L1e200 1' })]),
  ])
    expect(check(root).ok).toBe(false);
});

it('NFR-SEC-001: repeated use and nested SVG offsets compose before finite checks', () => {
  const linked = (offset: string) =>
    node('g', {}, [
      node('defs', {}, [node('rect', { id: 'r', width: '1', height: '1' }), node('use', { id: 'u', href: '#r', x: offset })]),
      node('use', { href: '#u', x: offset }),
    ]);
  expect(check(linked('1e308')).ok).toBe(false);
  expect(check(linked('4e307')).ok).toBe(true);
  expect(check(node('svg', { x: '1e308' }, [node('svg', { x: '1e308' }, [node('rect', { width: '1', height: '1' })])])).ok).toBe(false);
  expect(
    check(node('g', { transform: 'scale(1e200)' }, [node('use', { href: '#r', y: '1e200' }), node('rect', { id: 'r', width: '1', height: '1' })])).ok,
  ).toBe(false);
});
