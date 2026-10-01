import type { RichTextMark } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { planMarks } from './rich-marks.js';

const mark = (type: string, attrs?: Record<string, unknown>): RichTextMark => (attrs === undefined ? { type } : { type, attrs });

describe('what rich-text marks draw (FR-TXT-001, NFR-SEC-001)', () => {
  it('FR-TXT-001: bold, italic, underline, strike and code are elements; the same marks always nest the same way', () => {
    expect(planMarks([mark('code'), mark('strike'), mark('underline'), mark('italic'), mark('bold')]).map((p) => p.tag)).toEqual([
      'strong',
      'em',
      'u',
      's',
      'code',
    ]);
    expect(planMarks(undefined)).toEqual([]);
    expect(planMarks([])).toEqual([]);
  });

  it('FR-TXT-001: nesting runs link, then the styles, then the highlight, colour, size and font', () => {
    const marks = [
      mark('font', { family: 'Georgia' }),
      mark('size', { size: 20 }),
      mark('color', { color: '#112233' }),
      mark('highlight', { color: '#ffee00' }),
      mark('bold'),
      mark('link', { href: 'https://example.com/a' }),
    ];
    expect(planMarks(marks).map((p) => p.tag)).toEqual(['a', 'strong', 'mark', 'span', 'span', 'span']);
  });

  it('FR-TXT-001: colour, highlight and size take a value or a token; the token becomes the theme`s CSS variable', () => {
    const plans = planMarks([mark('color', { color: '#abc' }), mark('highlight', { color: '{color.accent.soft}' }), mark('size', { size: 18.5 })]);
    expect(plans).toEqual([
      { tag: 'mark', style: { backgroundColor: 'var(--fx-color-accent-soft)', color: 'inherit' } },
      { tag: 'span', style: { color: '#abc' } },
      { tag: 'span', style: { fontSize: '18.5px' } },
    ]);
    expect(planMarks([mark('size', { size: '{font.size.lg}' }), mark('color', { color: '#12345678' })])).toEqual([
      { tag: 'span', style: { color: '#12345678' } },
      { tag: 'span', style: { fontSize: 'var(--fx-font-size-lg)' } },
    ]);
  });

  it('NFR-SEC-001: a value that is not a hex colour or a token draws nothing, so no CSS can be smuggled in', () => {
    for (const color of ['red', 'rgb(0,0,0)', '#12', '#12345', '#gggggg', 'url(x)', '#fff;background:url(x)', '{a;b}', '{a b}', '{}', 5, null, undefined])
      expect(planMarks([mark('color', { color }), mark('highlight', { color })]), String(color)).toEqual([]);
    for (const size of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, '12px', '{x;y}', '{ }', true, undefined])
      expect(planMarks([mark('size', { size })]), String(size)).toEqual([]);
    expect(planMarks([mark('color'), mark('size'), mark('font'), mark('link'), mark('highlight')])).toEqual([]);
  });

  it('NFR-SEC-001: a font family is one quoted CSS string: quotes and backslashes are escaped, control characters dropped', () => {
    expect(planMarks([mark('font', { family: 'Fira Sans' })])).toEqual([{ tag: 'span', style: { fontFamily: '"Fira Sans"' } }]);
    expect(planMarks([mark('font', { family: 'a";background:url(x);"' })])[0]?.style?.['fontFamily']).toBe('"a\\";background:url(x);\\""');
    const dirty = String.raw`back\slash` + String.fromCharCode(10) + 'line' + String.fromCharCode(0) + 'end';
    expect(planMarks([mark('font', { family: dirty })])[0]?.style?.['fontFamily']).toBe(String.raw`"back\\slashlineend"`);
    expect(planMarks([mark('font', { family: '{font.body}' })])).toEqual([{ tag: 'span', style: { fontFamily: 'var(--fx-font-body)' } }]);
    for (const family of ['', '\n\u0001', '{broken', '{x;y}', 7, undefined]) expect(planMarks([mark('font', { family })]), String(family)).toEqual([]);
  });

  it('NFR-SEC-001: only http, https, mailto and in-document screen links are links; anything else is plain text', () => {
    for (const href of ['https://example.com', 'http://example.com/a?b=c', 'HTTPS://EXAMPLE.COM', 'mailto:a@b.c', '#screen:abc_123-X'])
      expect(planMarks([mark('link', { href })]), href).toEqual([{ tag: 'a', href }]);
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      '\tjavascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'file:///etc/passwd',
      '//example.com',
      '/relative',
      '#screen:',
      '#screen:a b',
      '#screen:' + 'a'.repeat(65),
      '#other',
      '',
      5,
      null,
      undefined,
    ])
      expect(planMarks([mark('link', { href })]), String(href)).toEqual([]);
    // a link`s title is kept when it is text
    expect(planMarks([mark('link', { href: 'https://example.com', title: 'Example' })])).toEqual([{ tag: 'a', href: 'https://example.com', title: 'Example' }]);
    expect(planMarks([mark('link', { href: 'https://example.com', title: 5 })])).toEqual([{ tag: 'a', href: 'https://example.com' }]);
  });

  it('FR-TXT-001: an unknown mark draws nothing, and only the first mark of a type counts', () => {
    expect(planMarks([mark('sparkle'), mark('bold')]).map((p) => p.tag)).toEqual(['strong']);
    const twice = planMarks([mark('color', { color: '#111111' }), mark('color', { color: '#222222' })]);
    expect(twice).toEqual([{ tag: 'span', style: { color: '#111111' } }]);
    // an unsafe first mark of a type is not replaced by the second
    expect(planMarks([mark('link', { href: 'javascript:x' }), mark('link', { href: 'https://example.com' })])).toEqual([]);
  });
});
