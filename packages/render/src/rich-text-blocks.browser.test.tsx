import type { RichTextDoc, RichTextNode } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_CSS } from './content-css.js';
import { RichText } from './rich-text.js';

let host: HTMLElement;
let root: Root;
let css: HTMLStyleElement;
beforeEach(() => {
  // the content CSS the screen carries, so headings and lists are sized and indented as they are drawn
  css = document.createElement('style');
  css.textContent = CONTENT_CSS;
  document.head.append(css);
  host = document.createElement('div');
  host.className = 'fx-label';
  host.style.cssText = 'position: relative; width: 300px; font: 16px/1.5 sans-serif;';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  css.remove();
});

const t = (text: string): RichTextNode => ({ type: 'text', text });
const p = (text: string, attrs?: Record<string, unknown>): RichTextNode => ({
  type: 'paragraph',
  ...(attrs === undefined ? {} : { attrs }),
  content: [t(text)],
});
const item = (...content: RichTextNode[]): RichTextNode => ({ type: 'listItem', content });
const doc = (...content: RichTextNode[]): RichTextDoc => ({ type: 'doc', content });

async function draw(d: RichTextDoc) {
  await act(async () => root.render(<RichText doc={d} />));
  return host;
}
const style = (selector: string) => getComputedStyle(host.querySelector(selector) as HTMLElement);

describe('rich-text blocks (FR-TXT-001)', () => {
  it('FR-TXT-001: the heading block matches its golden', async () => {
    await draw(doc(...[1, 2, 3, 4, 5, 6].map((level) => ({ type: 'heading', attrs: { level }, content: [t(`Heading ${level}`)] }) as RichTextNode)));
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-heading.html');
    // each level is smaller than the one above, and bold
    const sizes = [1, 2, 3, 4, 5, 6].map((n) => Number.parseFloat(style(`h${n}`).fontSize));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBeGreaterThan(4);
    expect(style('h1').fontWeight).toBe('700');
  });

  it('FR-TXT-001: the bullet list block matches its golden', async () => {
    await draw(doc({ type: 'bulletList', content: [item(p('one')), item(p('two'))] }));
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-bullet-list.html');
    expect([style('ul').listStyleType, Number.parseFloat(style('ul').paddingLeft) > 0]).toEqual(['disc', true]);
    expect(host.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('FR-TXT-001: the ordered list block matches its golden', async () => {
    await draw(doc({ type: 'orderedList', attrs: { start: 3 }, content: [item(p('three')), item(p('four'))] }));
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-ordered-list.html');
    expect([style('ol').listStyleType, host.querySelector('ol')?.start]).toEqual(['decimal', 3]);
  });

  it('FR-TXT-001: the nested list block matches its golden', async () => {
    await draw(
      doc({
        type: 'bulletList',
        content: [item(p('outer'), { type: 'orderedList', content: [item(p('inner'), { type: 'bulletList', content: [item(p('deepest'))] })] })],
      }),
    );
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-nested-list.html');
    expect(host.querySelector('ul > li > ol > li > ul > li > p')?.textContent).toBe('deepest');
    // a list inside a list indents further and uses another marker
    const inner = host.querySelector('ul ol ul') as HTMLElement;
    expect(getComputedStyle(inner).listStyleType).toBe('circle');
    expect(inner.getBoundingClientRect().left).toBeGreaterThan((host.querySelector('ul') as HTMLElement).getBoundingClientRect().left + 30);
  });

  it('NFR-SEC-001: lists nested far past the schema`s limit (a document never validated) are drawn as text, not a stack overflow', async () => {
    let hostile: RichTextNode = p('far down');
    for (let i = 0; i < 40_000; i++) hostile = { type: 'bulletList', content: [item(hostile)] };
    await draw(doc(hostile));
    expect(host.textContent).toContain('far down');
    // 32 lists (64 levels of list and item) are drawn as lists; the rest is a paragraph
    expect(host.querySelectorAll('ul')).toHaveLength(32);
  });

  it('FR-TXT-001: the alignment block matches its golden', async () => {
    await draw(
      doc(p('left', { align: 'left' }), p('center', { align: 'center' }), p('right', { align: 'right' }), p('justify', { align: 'justify' }), {
        type: 'heading',
        attrs: { level: 2, align: 'center' },
        content: [t('Centred')],
      }),
    );
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-alignment.html');
    expect([...host.querySelectorAll('p')].map((el) => getComputedStyle(el).textAlign)).toEqual(['left', 'center', 'right', 'justify']);
    expect(style('h2').textAlign).toBe('center');
  });

  it('FR-TXT-001: the spacing block matches its golden', async () => {
    await draw(
      doc(p('tight', { lineHeight: 1 }), p('loose', { lineHeight: 3 }), p('before', { spaceBefore: 20 }), p('after', { spaceAfter: 30 }), {
        type: 'heading',
        attrs: { level: 3, spaceBefore: 12, spaceAfter: 6, lineHeight: 2 },
        content: [t('Spaced')],
      }),
    );
    await expect(host.innerHTML).toMatchFileSnapshot('../__golden__/rich-text/block-spacing.html');
    const [tight, loose, before, after] = [...host.querySelectorAll('p')].map((el) => getComputedStyle(el));
    // a block's own line height replaces the style's (1.5 here)
    expect([tight?.lineHeight, loose?.lineHeight]).toEqual(['16px', '48px']);
    expect([before?.marginTop, after?.marginBottom]).toEqual(['20px', '30px']);
    expect([style('h3').marginTop, style('h3').marginBottom]).toEqual(['12px', '6px']);
  });
});
