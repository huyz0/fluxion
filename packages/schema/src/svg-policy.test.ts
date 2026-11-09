import { describe, expect, it } from 'vitest';
import { checkedSvgAttribute, isSvgElement, isSvgTextElement, SVG_POLICY_LIMITS } from './index.js';

describe('shared decoded SVG policy', () => {
  it('NFR-SEC-001: public predicates reject unknown and prototype-like elements', () => {
    for (const name of ['svg', 'path', 'linearGradient', 'clipPath', 'use']) expect(isSvgElement(name)).toBe(true);
    for (const name of ['script', 'image', 'foreignObject', '__proto__', 'constructor', 'PATH']) {
      expect(isSvgElement(name)).toBe(false);
      expect(checkedSvgAttribute(name, 'fill', 'red')).toBeUndefined();
    }
    expect(isSvgTextElement('text')).toBe(true);
    expect(isSvgTextElement('title')).toBe(true);
    expect(isSvgTextElement('path')).toBe(false);
  });
  it('FR-LIB-004: decoded local references and styles use existing normalization', () => {
    expect(checkedSvgAttribute('use', 'xlink:href', ' #shape ')).toEqual({ name: 'href', value: '#shape' });
    expect(checkedSvgAttribute('path', 'fill', ' url(#gradient) ')).toEqual({ name: 'fill', value: 'url(#gradient)' });
    expect(checkedSvgAttribute('path', 'style', ' FILL : red ; background:url(https://bad); stroke : rgb(1,2,3) ')).toEqual({
      name: 'style',
      value: 'fill:red;stroke:rgb(1,2,3)',
    });
    expect(checkedSvgAttribute('path', 'd', 'M0 0L2 3')).toEqual({ name: 'd', value: 'M0 0L2 3' });
  });
  it('NFR-SEC-001: decoded hostile values cannot cross the shared boundary', () => {
    for (const value of [
      'javascript:alert(1)',
      'ja\tvascript:alert(1)',
      'url(https://bad)',
      'url(//bad)',
      'var(--remote)',
      'image-set(url(#a))',
      'data:image/svg+xml,bad',
      'red/*x*/',
      'url(\\23 local)',
    ]) {
      expect(checkedSvgAttribute('path', 'fill', value), value).toBeUndefined();
    }
    for (const value of ['external.svg#shape', '#bad id', 'https://bad']) expect(checkedSvgAttribute('use', 'href', value)).toBeUndefined();
    expect(checkedSvgAttribute('path', 'onload', 'alert(1)')).toBeUndefined();
    expect(checkedSvgAttribute('path', 'style', 'background:red')).toBeUndefined();
  });
  it('NFR-SEC-001: resource limits remain fixed and immutable', () => {
    expect(SVG_POLICY_LIMITS).toEqual({ maxChars: 2 * 1024 * 1024, maxDepth: 64, maxNodes: 20_000 });
    expect(Object.isFrozen(SVG_POLICY_LIMITS)).toBe(true);
  });
});

// Each table entry is checked by name, so an element, attribute, property or function dropped from
// the policy (or added to it) changes a verdict here.
describe('NFR-SEC-001 FR-LIB-004: the SVG policy tables, entry by entry', () => {
  const ELEMENTS: Record<string, string[]> = {
    svg: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'x', 'y'],
    g: ['transform'],
    defs: [],
    symbol: ['viewBox', 'preserveAspectRatio'],
    use: ['href', 'xlink:href', 'x', 'y', 'width', 'height', 'transform'],
    path: ['d', 'transform', 'pathLength'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'transform'],
    circle: ['cx', 'cy', 'r', 'transform'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'transform'],
    line: ['x1', 'y1', 'x2', 'y2', 'transform'],
    polyline: ['points', 'transform'],
    polygon: ['points', 'transform'],
    text: ['x', 'y', 'dx', 'dy', 'transform', 'text-anchor', 'textLength'],
    tspan: ['x', 'y', 'dx', 'dy', 'text-anchor'],
    title: [],
    desc: [],
    linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
    radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
    stop: ['offset', 'stop-color', 'stop-opacity'],
    clipPath: ['clipPathUnits', 'transform'],
    mask: ['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height'],
    marker: ['markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', 'preserveAspectRatio'],
  };
  const PRESENTATION = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'opacity',
    'clip-path',
    'clip-rule',
    'mask',
    'marker-start',
    'marker-mid',
    'marker-end',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-decoration',
    'visibility',
    'display',
    'stop-color',
    'stop-opacity',
  ];
  const ALL_ATTRIBUTES = [...new Set(Object.values(ELEMENTS).flat())];
  const value = (name: string) => (name === 'href' || name === 'xlink:href' ? '#a' : '1');

  it.each(Object.keys(ELEMENTS))('NFR-SEC-001: <%s> keeps exactly its own attributes and the common ones', (element) => {
    expect(isSvgElement(element)).toBe(true);
    for (const name of ELEMENTS[element] ?? [])
      expect(checkedSvgAttribute(element, name, value(name)), `${element} ${name}`).toEqual({
        name: name === 'xlink:href' ? 'href' : name,
        value: value(name),
      });
    for (const name of ALL_ATTRIBUTES.filter((n) => !(ELEMENTS[element] ?? []).includes(n) && !PRESENTATION.includes(n)))
      expect(checkedSvgAttribute(element, name, value(name)), `${element} ${name}`).toBeUndefined();
    for (const name of [...PRESENTATION, 'id', 'class']) expect(checkedSvgAttribute(element, name, 'a'), `${element} ${name}`).toEqual({ name, value: 'a' });
    expect(checkedSvgAttribute(element, 'style', 'fill:red')).toEqual({ name: 'style', value: 'fill:red' });
    expect(checkedSvgAttribute(element, 'onclick', 'a')).toBeUndefined();
  });

  it('NFR-SEC-001: only the four textual elements keep text', () => {
    for (const element of Object.keys(ELEMENTS)) expect(isSvgTextElement(element), element).toBe(['text', 'tspan', 'title', 'desc'].includes(element));
  });

  it.each(PRESENTATION)('NFR-SEC-001: style may set %s, and nothing outside the presentation list', (property) => {
    expect(checkedSvgAttribute('g', 'style', `${property}: a`)).toEqual({ name: 'style', value: `${property}:a` });
  });

  it('NFR-SEC-001: style drops declarations without a colon, unknown properties and empty values', () => {
    expect(checkedSvgAttribute('g', 'style', 'fill:red;stroke;opacity:;id:x;class:y;style:z;transform:scale(2);x:1')).toEqual({
      name: 'style',
      value: 'fill:red',
    });
    expect(checkedSvgAttribute('g', 'style', 'stroke')).toBeUndefined();
    // a declaration without a colon is dropped whole, not read as a property cut one character short
    expect(checkedSvgAttribute('g', 'style', 'fillx')).toBeUndefined();
  });

  it('NFR-SEC-001: href and xlink:href take only a local id', () => {
    for (const ok of ['#a', '#_a', '#a.b:c-d_1']) expect(checkedSvgAttribute('use', 'href', ok), ok).toEqual({ name: 'href', value: ok });
    for (const bad of ['a', '#1a', '#', '#a b', 'x#a', '#a!']) expect(checkedSvgAttribute('use', 'href', bad), bad).toBeUndefined();
    expect(checkedSvgAttribute('linearGradient', 'xlink:href', '#g')).toEqual({ name: 'href', value: '#g' });
  });

  it.each(['url', 'rgb', 'rgba', 'hsl', 'hsla', 'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley', 'matrix', 'skewx', 'skewy'])(
    'NFR-SEC-001: %s() is an allowed function',
    (fn) => {
      const arg = fn === 'url' ? '#a' : '1';
      expect(checkedSvgAttribute('g', 'fill', `${fn}(${arg})`)).toEqual({ name: 'fill', value: `${fn}(${arg})` });
      expect(checkedSvgAttribute('g', 'fill', `${fn.toUpperCase()}(${arg})`)).toEqual({ name: 'fill', value: `${fn.toUpperCase()}(${arg})` });
    },
  );

  it('NFR-SEC-001: any other function, and url() of anything but a local id, is refused', () => {
    for (const bad of ['calc(1)', 'var(--a)', 'image(a)', 'src(a)', 'url(a)', "url('a')", 'url(a#b)', 'rgb(1) attr(x)'])
      expect(checkedSvgAttribute('g', 'fill', bad), bad).toBeUndefined();
    for (const good of ["url('#a')", 'url("#a")', 'url(#a) rgb(1,2,3)', 'rgb(1) url(#a)'])
      expect(checkedSvgAttribute('g', 'fill', good), good).toEqual({ name: 'fill', value: good });
  });

  it('NFR-SEC-001: every external or script scheme is refused, after dropping controls and white space', () => {
    for (const scheme of ['javascript', 'vbscript', 'data', 'file', 'http', 'https', 'ftp', 'blob'])
      expect(checkedSvgAttribute('g', 'fill', `${scheme}:x`), scheme).toBeUndefined();
    for (const c of ['\u0000', '\u001f', ' ', '\u007f', '\u0080', '\u009f'])
      expect(checkedSvgAttribute('g', 'fill', `java${c}script:x`), `U+${c.charCodeAt(0).toString(16)}`).toBeUndefined();
    // U+00A0 and U+0021 are not ignorable, so the scheme is not formed.
    for (const c of ['\u00a0', '!']) expect(checkedSvgAttribute('g', 'fill', `java${c}script:x`)).toEqual({ name: 'fill', value: `java${c}script:x` });
    for (const bad of ['@import x', 'a<b', 'a\\b', 'a/*b', 'a//b', 'JavaScript:x']) expect(checkedSvgAttribute('g', 'fill', bad), bad).toBeUndefined();
    expect(checkedSvgAttribute('g', 'fill', 'a/b')).toEqual({ name: 'fill', value: 'a/b' });
  });

  it('NFR-SEC-001: an attribute is refused on an element outside the allowlist, and kept trimmed', () => {
    expect(checkedSvgAttribute('path', 'x', '1')).toBeUndefined();
    expect(checkedSvgAttribute('rect', 'x', '  1 ')).toEqual({ name: 'x', value: '1' });
    expect(checkedSvgAttribute('foreignObject', 'x', '1')).toBeUndefined();
    expect(checkedSvgAttribute('hasOwnProperty', 'fill', 'red')).toBeUndefined();
  });
});
