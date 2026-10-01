import type { RichTextNode } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { planBlock } from './rich-blocks.js';

const node = (type: string, attrs?: Record<string, unknown>): RichTextNode => (attrs === undefined ? { type } : { type, attrs });

describe('what rich-text blocks draw (FR-TXT-001)', () => {
  it('FR-TXT-001: a paragraph, a list and a list item are p, ul, ol and li; a heading is h1 to h6 by its level', () => {
    expect(['paragraph', 'bulletList', 'orderedList', 'listItem'].map((t) => planBlock(node(t))?.tag)).toEqual(['p', 'ul', 'ol', 'li']);
    expect([1, 2, 3, 4, 5, 6].map((level) => planBlock(node('heading', { level }))?.tag)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    // a level that is not 1 to 6 is a paragraph, not a missing block
    for (const level of [0, 7, 1.5, '2', undefined, null]) expect(planBlock(node('heading', { level }))?.tag, String(level)).toBe('p');
  });

  it('FR-TXT-001: an ordered list says its first number only when it is not 1', () => {
    expect(planBlock(node('orderedList', { start: 4 }))).toEqual({ tag: 'ol', start: 4 });
    for (const start of [1, 0, -2, 2.5, '3', undefined]) expect(planBlock(node('orderedList', { start })), String(start)).toEqual({ tag: 'ol' });
    expect(planBlock(node('bulletList', { start: 4 }))).toEqual({ tag: 'ul' });
  });

  it('FR-TXT-001: alignment, line height and the space around a block become its style', () => {
    expect(planBlock(node('paragraph', { align: 'justify', lineHeight: 2, spaceBefore: 6, spaceAfter: 0 }))).toEqual({
      tag: 'p',
      style: { textAlign: 'justify', lineHeight: '2', marginTop: '6px', marginBottom: '0px' },
    });
    expect(planBlock(node('heading', { level: 3, align: 'left' }))).toEqual({ tag: 'h3', style: { textAlign: 'left' } });
    for (const align of ['left', 'center', 'right', 'justify']) expect(planBlock(node('paragraph', { align }))?.style?.['textAlign']).toBe(align);
    expect(planBlock(node('paragraph'))).toEqual({ tag: 'p' });
    // a level means something to a heading only
    expect(planBlock(node('paragraph', { level: 2 }))).toEqual({ tag: 'p' });
  });

  it('NFR-SEC-001: a value outside its range, or not a number, is left out of the style', () => {
    for (const lineHeight of [0.49, 4.01, Number.NaN, Number.POSITIVE_INFINITY, '1.5', null])
      expect(planBlock(node('paragraph', { lineHeight })), String(lineHeight)).toEqual({ tag: 'p' });
    for (const space of [-0.1, 400.1, Number.NaN, '8', null]) {
      expect(planBlock(node('paragraph', { spaceBefore: space })), String(space)).toEqual({ tag: 'p' });
      expect(planBlock(node('paragraph', { spaceAfter: space })), String(space)).toEqual({ tag: 'p' });
    }
    for (const align of ['middle', 'start', 'LEFT', '', 5, null]) expect(planBlock(node('paragraph', { align })), String(align)).toEqual({ tag: 'p' });
    // the limits themselves are in range
    expect(planBlock(node('paragraph', { lineHeight: 0.5, spaceBefore: 400 }))?.style).toEqual({ lineHeight: '0.5', marginTop: '400px' });
    expect(planBlock(node('paragraph', { lineHeight: 4, spaceAfter: 0 }))?.style).toEqual({ lineHeight: '4', marginBottom: '0px' });
  });

  it('FR-TXT-001: a node this version does not know, or an inline one, is no block', () => {
    for (const type of ['sparkle', 'text', 'hardBreak', 'field', 'doc', '__proto__', '']) expect(planBlock(node(type)), type).toBeUndefined();
  });
});
