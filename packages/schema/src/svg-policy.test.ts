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
