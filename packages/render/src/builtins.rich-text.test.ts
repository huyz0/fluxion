import type { DocumentFile, RecordId, RichTextDoc, RichTextNode } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { planMarks } from './rich-marks.js';
import { renderDocumentToHtml } from './ssr.js';

/** The static HTML of a document with one `text` element holding `blocks`. */
function drawn(blocks: readonly RichTextNode[]): string {
  const b = documentBuilder({ seed: 79 });
  const screen = b.screen({ size: { w: 400, h: 300 } });
  const rect = b.rect(screen, { x: 20, y: 30, w: 200, h: 60 });
  const file = b.build();
  const records = structuredClone(file.records) as Record<string, Record<string, unknown>>;
  const text: RichTextDoc = { type: 'doc', content: blocks };
  records[rect as RecordId] = { ...(records[rect as RecordId] as object), kind: 'text', text };
  Reflect.deleteProperty(records[rect as RecordId] as object, 'defId');
  return renderDocumentToHtml({ ...file, records } as DocumentFile, { registries: builtinRegistries() }).html;
}

const run = (text: string, marks?: RichTextNode['marks']): RichTextNode => ({ type: 'text', text, ...(marks === undefined ? {} : { marks }) });

describe('rich text in static HTML (FR-TXT-001, FR-EDT-007)', () => {
  it("FR-EDT-007: a kind 'text' element is drawn by the built-in view, in static HTML as in the editor", () => {
    const html = drawn([{ type: 'paragraph', content: [run('Hello '), run('world', [{ type: 'bold' }])] }]);
    expect(html).toContain('<div class="fx-label fx-text"');
    expect(html).toContain('<p>Hello <strong>world</strong></p>');
    expect(html).not.toContain('class="fx-placeholder"');
    expect(builtinRegistries().elementViews.source('text')).toBe('core');
  });

  it('FR-TXT-001: line breaks, fields and the text under blocks other than paragraphs are kept', () => {
    const html = drawn([
      { type: 'paragraph', content: [run('one'), { type: 'hardBreak' }, run('two')] },
      { type: 'paragraph', content: [{ type: 'field', attrs: { name: 'page' } }] },
      { type: 'heading', attrs: { level: 2 }, content: [run('Title')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('item')] }] }] },
      { type: 'paragraph' },
    ]);
    expect(html).toContain('<p>one<br/>two</p>');
    expect(html).toContain('<p>{{page}}</p>');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<ul><li><p>item</p></li></ul>');
    expect(html).toContain('<p></p>');
  });

  it('NFR-SEC-001: an unsafe link, colour or token is plain text in static HTML; a safe one is drawn', () => {
    const html = drawn([
      {
        type: 'paragraph',
        content: [
          run('bad', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
          run('good', [{ type: 'link', attrs: { href: 'https://example.com', title: 'Example' } }]),
          run('tinted', [{ type: 'color', attrs: { color: '{color.accent}' } }]),
        ],
      },
    ]);
    expect(html).not.toMatch(/javascript:/);
    expect(html).toContain('<a href="https://example.com" title="Example" rel="noopener noreferrer">good</a>');
    expect(html).toContain('<span style="color:var(--fx-color-accent)">tinted</span>');
  });
});

describe('rich-text blocks in static HTML (FR-TXT-001)', () => {
  it('FR-TXT-001: headings, lists, alignment and spacing are drawn as their elements, with their values checked', () => {
    const html = drawn([
      { type: 'heading', attrs: { level: 2, align: 'center', lineHeight: 1.2 }, content: [run('Title')] },
      { type: 'paragraph', attrs: { align: 'right', spaceBefore: 8, spaceAfter: 16 }, content: [run('Body')] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [run('one')] },
              { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('three')] }] }] },
            ],
          },
        ],
      },
      { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('first')] }] }] },
    ]);
    expect(html).toContain('<h2 style="text-align:center;line-height:1.2">Title</h2>');
    expect(html).toContain('<p style="text-align:right;margin-top:8px;margin-bottom:16px">Body</p>');
    expect(html).toContain('<ul><li><p>one</p><ol start="3"><li><p>three</p></li></ol></li></ul>');
    expect(html).toContain('<ol><li><p>first</p></li></ol>');
  });

  it('NFR-SEC-001: an alignment, spacing or level that is not valid is left out; an unknown block or hostile depth is drawn as text', () => {
    let deep: RichTextNode = { type: 'paragraph', content: [run('bottom')] };
    for (let i = 0; i < 100; i++) deep = { type: 'bulletList', content: [{ type: 'listItem', content: [deep] }] };
    const html = drawn([
      { type: 'heading', attrs: { level: 9, align: 'sideways', lineHeight: 99, spaceBefore: -1, spaceAfter: '3' }, content: [run('odd')] },
      { type: 'heading', attrs: { level: 1.5 }, content: [run('half')] },
      { type: 'heading', content: [run('none')] },
      { type: 'sparkle', content: [run('new '), run('block', [{ type: 'bold' }])] },
      { type: 'orderedList', attrs: { start: 0 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('zero')] }] }] },
      { type: 'orderedList', attrs: { start: 2.5 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [run('frac')] }] }] },
      deep,
    ]);
    expect(html).toContain('<p>odd</p>');
    expect(html).toContain('<p>half</p>');
    expect(html).toContain('<p>none</p>');
    expect(html).toContain('<p>new <strong>block</strong></p>');
    expect(html).toContain('<ol><li><p>zero</p></li></ol>');
    expect(html).toContain('<ol><li><p>frac</p></li></ol>');
    // past the depth limit (a list and its item are two levels, 64 in all) the rest is a paragraph of its text
    const alone = drawn([deep]);
    expect([alone.match(/<ul>/g)?.length, alone.match(/<li>/g)?.length]).toEqual([32, 32]);
    expect(html).toContain('<p>bottom</p>');
    expect(html).not.toContain('start="0"');
  });
});

describe('what a mark`s value must look like to draw (NFR-SEC-001)', () => {
  const one = (type: string, attrs: Record<string, unknown>) => planMarks([{ type, attrs }]).length;

  it('NFR-SEC-001: a link, colour or token is matched whole: text around a valid one makes it invalid', () => {
    expect([
      one('link', { href: 'xhttps://example.com' }),
      one('link', { href: 'javascript:alert(1)//https://example.com' }),
      one('link', { href: 'x#screen:abc' }),
      one('color', { color: 'x#fff' }),
      one('color', { color: '#fffx' }),
      one('color', { color: 'x{color.a}' }),
      one('color', { color: '{color.a}x' }),
      one('size', { size: 'x{font.size.md}' }),
      one('size', { size: '{font.size.md}x' }),
    ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([one('link', { href: 'https://example.com' }), one('color', { color: '#fff' }), one('color', { color: '{color.a}' })]).toEqual([1, 1, 1]);
  });
});
