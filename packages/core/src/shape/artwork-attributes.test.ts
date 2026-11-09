// FR-LIB-004 / NFR-SEC-001: each attribute, style and reference rule is read back by name, so a
// dropped role, target list, paint keyword or bound changes a verdict here.
import { SVG_POLICY_LIMITS } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { artworkAttributes, artworkReferences } from './artwork-attributes.js';

const node = (name: string, attributes: Record<string, string> = {}, children: unknown[] = []) =>
  ({ name, attributes, children }) as Parameters<typeof artworkAttributes>[0];
const GRADIENTS = ['linearGradient', 'radialGradient'];
const GRAPHICS = ['svg', 'symbol', 'g', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan'];

describe('artworkAttributes', () => {
  it('FR-LIB-004: kept attributes come back decoded, with the style split out', () => {
    expect(artworkAttributes(node('rect', { x: ' 1 ', fill: 'red' }))).toEqual([{ x: '1', fill: 'red' }, {}]);
    expect(artworkAttributes(node('g', { style: ' FILL : red ; stroke:blue; ' }))).toEqual([{}, { fill: 'red', stroke: 'blue' }]);
    expect(artworkAttributes(node('use', { 'xlink:href': '#a' }))).toEqual([{ href: '#a' }, {}]);
    expect(artworkAttributes(node('g', { id: 'a.b:c-d_1' }))).toEqual([{ id: 'a.b:c-d_1' }, {}]);
    expect(artworkAttributes(node('g', {}, [node('rect')]))).toEqual([{}, {}]);
  });

  it('NFR-SEC-001: text is kept only in the textual elements', () => {
    for (const name of ['text', 'tspan', 'title', 'desc']) expect(artworkAttributes(node(name, {}, ['x'])), name).toEqual([{}, {}]);
    for (const name of ['g', 'rect', 'svg']) expect(artworkAttributes(node(name, {}, ['x'])), name).toBeUndefined();
  });

  it('NFR-SEC-001: an element, attribute, duplicate or id outside the policy is refused whole', () => {
    expect(artworkAttributes(node('script'))).toBeUndefined();
    expect(artworkAttributes(node('rect', { onclick: 'a' }))).toBeUndefined();
    expect(artworkAttributes(node('use', { href: '#a', 'xlink:href': '#b' }))).toBeUndefined();
    for (const id of ['1a', 'a b', '-a', 'a!']) expect(artworkAttributes(node('g', { id })), id).toBeUndefined();
  });

  it('NFR-SEC-001: a style is refused when empty, malformed, repeated, unknown or unsafe', () => {
    for (const style of ['', ' ; ', 'fill', 'fill:red;fill:blue', 'fill:red;FILL:blue', 'background:red', 'fill:url(https://x)', 'fill:'])
      expect(artworkAttributes(node('g', { style })), JSON.stringify(style)).toBeUndefined();
    expect(artworkAttributes(node('g', { style: 'fill:red;;stroke:blue' }))).toEqual([{}, { fill: 'red', stroke: 'blue' }]);
  });
});

describe('artworkReferences', () => {
  const refs = (attributes: Record<string, string>, name = 'g') => artworkReferences(name, attributes);

  it('FR-LIB-004: href points at graphics from use, and at gradients from anything else', () => {
    expect(refs({ href: '#a' }, 'use')).toEqual([{ id: 'a', targets: GRAPHICS }]);
    expect(refs({ href: '#g' }, 'linearGradient')).toEqual([{ id: 'g', targets: GRADIENTS }]);
  });

  it.each([
    ['fill', GRADIENTS],
    ['stroke', GRADIENTS],
    ['clip-path', ['clipPath']],
    ['mask', ['mask']],
    ['marker-start', ['marker']],
    ['marker-mid', ['marker']],
    ['marker-end', ['marker']],
  ])('FR-LIB-004: %s url() points at %j', (key, targets) => {
    expect(refs({ [key]: 'url(#a)' })).toEqual([{ id: 'a', targets }]);
    expect(refs({ [key]: "url( '#a' )" })).toEqual([{ id: 'a', targets }]);
    expect(refs({ [key]: 'URL("#a")' })).toEqual([{ id: 'a', targets }]);
  });

  it('NFR-SEC-001: url() in an attribute that takes no reference, or of a malformed id, is refused', () => {
    for (const key of ['opacity', 'stop-color', 'd']) expect(refs({ [key]: 'url(#a)' }), key).toBeUndefined();
    for (const value of ['url(#1a)', 'url(\'#a")', 'url(a)', 'url (#a)']) expect(refs({ fill: value }), value).toBeUndefined();
  });

  it('FR-LIB-004: a paint without url() is a colour or a keyword', () => {
    for (const value of ['red', '#fff', 'none', 'currentColor', 'CURRENTCOLOR', 'inherit'])
      for (const key of ['fill', 'stroke', 'stop-color']) expect(refs({ [key]: value }), `${key} ${value}`).toEqual([]);
    for (const key of ['fill', 'stroke', 'stop-color']) expect(refs({ [key]: 'bogus' }), key).toBeUndefined();
    expect(refs({ opacity: 'bogus' })).toEqual([]);
  });

  it('FR-LIB-004: a fill or stroke url() may carry a fallback paint; other roles carry nothing else', () => {
    expect(refs({ fill: 'url(#g) red' })).toEqual([{ id: 'g', targets: GRADIENTS }]);
    expect(refs({ stroke: 'url(#g) none' })).toEqual([{ id: 'g', targets: GRADIENTS }]);
    expect(refs({ fill: 'url(#g) bogus' })).toBeUndefined();
    expect(refs({ 'clip-path': 'url(#c) red' })).toBeUndefined();
    expect(refs({ mask: 'url(#m) red' })).toBeUndefined();
  });

  it('NFR-SEC-001: only mask takes more than one url(), up to the node budget', () => {
    expect(refs({ fill: 'url(#a) url(#b)' })).toBeUndefined();
    expect(refs({ 'clip-path': 'url(#a) url(#b)' })).toBeUndefined();
    expect(refs({ mask: 'url(#a) url(#b)' })).toEqual([
      { id: 'a', targets: ['mask'] },
      { id: 'b', targets: ['mask'] },
    ]);
    const many = (n: number) => Array.from({ length: n }, () => 'url(#a)').join(' ');
    expect(refs({ mask: many(SVG_POLICY_LIMITS.maxNodes) })).toHaveLength(SVG_POLICY_LIMITS.maxNodes);
    expect(refs({ mask: many(SVG_POLICY_LIMITS.maxNodes + 1) })).toBeUndefined();
  });

  it('FR-LIB-004: references of every attribute come back in order, and one bad value refuses all', () => {
    expect(refs({ fill: 'url(#a)', stroke: 'url(#b)', mask: 'url(#c)' })).toEqual([
      { id: 'a', targets: GRADIENTS },
      { id: 'b', targets: GRADIENTS },
      { id: 'c', targets: ['mask'] },
    ]);
    expect(refs({ fill: 'url(#a)', stroke: 'bogus' })).toBeUndefined();
    expect(refs({})).toEqual([]);
  });
});
