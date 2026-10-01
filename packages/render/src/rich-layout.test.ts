import type { RichTextDoc, RichTextNode } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { styledBlocks } from './rich-layout.js';

const t = (text: string, marks?: RichTextNode['marks']): RichTextNode => ({ type: 'text', text, ...(marks === undefined ? {} : { marks }) });
const p = (content: RichTextNode[], attrs?: Record<string, unknown>): RichTextNode => ({
  type: 'paragraph',
  ...(attrs === undefined ? {} : { attrs }),
  content,
});
const item = (...content: RichTextNode[]): RichTextNode => ({ type: 'listItem', content });
const doc = (...content: RichTextNode[]): RichTextDoc => ({ type: 'doc', content });
const mark = (type: string, attrs?: Record<string, unknown>) => (attrs === undefined ? { type } : { type, attrs });
const runs = (node: RichTextNode) => styledBlocks(doc(p([node])), LIGHT_THEME)[0]?.runs;

describe('rich text as the layout sees it (FR-TXT-002, M7.29)', () => {
  it('FR-TXT-002: marks become the weight, style, size and family of their run; marks that do not change the font change nothing', () => {
    expect(runs(t('a', [mark('bold')]))).toEqual([{ text: 'a', weight: 700 }]);
    expect(runs(t('a', [mark('italic')]))).toEqual([{ text: 'a', style: 'italic' }]);
    expect(runs(t('a', [mark('size', { size: 30 })]))).toEqual([{ text: 'a', size: 30 }]);
    expect(runs(t('a', [mark('font', { family: 'Georgia' })]))).toEqual([{ text: 'a', family: '"Georgia"' }]);
    expect(runs(t('a', [mark('code')]))).toEqual([{ text: 'a', em: 0.9, family: 'ui-monospace, monospace' }]);
    expect(runs(t('a', [mark('bold'), mark('italic'), mark('size', { size: 12 })]))).toEqual([{ text: 'a', weight: 700, style: 'italic', size: 12 }]);
    for (const m of [
      mark('underline'),
      mark('strike'),
      mark('color', { color: '#fff' }),
      mark('highlight', { color: '#fff' }),
      mark('link', { href: 'https://example.com' }),
      mark('sparkle'),
    ])
      expect(runs(t('a', [m])), m.type).toEqual([{ text: 'a' }]);
    // a mark that draws nothing (an unsafe size) changes nothing
    expect(runs(t('a', [mark('size', { size: -4 })]))).toEqual([{ text: 'a' }]);
  });

  it('FR-TXT-002: a token size or family is the theme`s value', () => {
    const size = styledBlocks(doc(p([t('a', [mark('size', { size: '{font.size.lg}' })])])), LIGHT_THEME)[0]?.runs[0]?.size;
    expect(size).toBeGreaterThan(16);
    const family = styledBlocks(doc(p([t('a', [mark('font', { family: '{font.mono}' })])])), LIGHT_THEME)[0]?.runs[0]?.family;
    expect(family).toMatch(/\S/);
    expect(family).not.toContain('var(');
  });

  it('FR-TXT-002: a token the theme does not have changes nothing: the run keeps the font around it', () => {
    expect(runs(t('a', [mark('size', { size: '{font.size.nope}' })]))).toEqual([{ text: 'a' }]);
    expect(runs(t('a', [mark('font', { family: '{font.nope}' })]))).toEqual([{ text: 'a' }]);
    expect(runs(t('a', [mark('size', { size: '{font.size.nope}' }), mark('font', { family: 'Georgia' })]))).toEqual([{ text: 'a', family: '"Georgia"' }]);
  });

  it('FR-TXT-002: a hard break is a newline run, a field its text, a text node with no text an empty run', () => {
    expect(styledBlocks(doc(p([t('a'), { type: 'hardBreak' }, { type: 'field', attrs: { name: 'page' } }, { type: 'text' }])), LIGHT_THEME)[0]?.runs).toEqual([
      { text: 'a' },
      { text: '\n' },
      { text: '{{page}}' },
      { text: '' },
    ]);
  });

  it('FR-TXT-002: a heading is its level`s scale in bold; a block`s own line height and spacing come along, out-of-range ones left out', () => {
    const heading = (level: number) => styledBlocks(doc({ type: 'heading', attrs: { level }, content: [t('H')] }), LIGHT_THEME)[0];
    expect([1, 2, 3, 4, 5, 6].map((l) => heading(l)?.scale)).toEqual([2, 1.5, 1.25, 1.1, 1, 0.9]);
    expect(heading(1)?.weight).toBe(700);
    // a level that is not 1 to 6 is a paragraph
    expect(heading(9)).toEqual({ runs: [{ text: 'H' }] });
    expect(styledBlocks(doc(p([t('a')], { lineHeight: 2, spaceBefore: 5, spaceAfter: 7 })), LIGHT_THEME)[0]).toEqual({
      runs: [{ text: 'a' }],
      lineHeight: 2,
      before: 5,
      after: 7,
    });
    expect(styledBlocks(doc(p([t('a')], { lineHeight: 9, spaceBefore: -1, spaceAfter: '3' })), LIGHT_THEME)[0]).toEqual({ runs: [{ text: 'a' }] });
  });

  it('FR-TXT-002: every item of a list is a block, indented 1.5 em per level; a nested list is one level deeper', () => {
    const list = {
      type: 'bulletList',
      content: [item(p([t('one')]), { type: 'orderedList', content: [item(p([t('inner')]))] }), item(p([t('two')]))],
    };
    const blocks = styledBlocks(doc(p([t('before')]), list, p([t('after')])), LIGHT_THEME);
    expect(blocks.map((b) => [b.runs[0]?.text, b.indentEm])).toEqual([
      ['before', undefined],
      ['one', 1.5],
      ['inner', 3],
      ['two', 1.5],
      ['after', undefined],
    ]);
  });

  it('FR-TXT-002: a block this version does not know is one block of its text; no document has no blocks', () => {
    expect(styledBlocks(doc({ type: 'sparkle', content: [p([t('new ')]), p([t('block')])] }), LIGHT_THEME)).toEqual([
      { runs: [{ text: 'new ' }, { text: 'block' }] },
    ]);
    expect(styledBlocks(undefined, LIGHT_THEME)).toEqual([]);
    expect(styledBlocks({ type: 'doc' }, LIGHT_THEME)).toEqual([]);
  });

  it('NFR-SEC-001: an unknown block`s attributes are never read: it is a block of its text with no spacing', () => {
    const unknown = { type: 'sparkle', attrs: { spaceBefore: 50, lineHeight: 3, level: 1 }, content: [t('x')] };
    expect(styledBlocks(doc(unknown), LIGHT_THEME)).toEqual([{ runs: [{ text: 'x' }] }]);
  });

  it('NFR-REL-002: the item at the depth limit is still walked: its children are blocks of their own', () => {
    // a list and its item are two levels, so the item of the 32nd list is at level 64
    let inner: RichTextNode = item(p([t('x')]), p([t('y')]));
    for (let i = 0; i < 31; i++) inner = item({ type: 'bulletList', content: [inner] });
    expect(styledBlocks(doc({ type: 'bulletList', content: [inner] }), LIGHT_THEME).map((b) => b.runs[0]?.text)).toEqual(['x', 'y']);
    // one level deeper it is one block of its text
    let past: RichTextNode = item(p([t('x')]), p([t('y')]));
    past = item({ type: 'bulletList', content: [past] });
    for (let i = 0; i < 31; i++) past = item({ type: 'bulletList', content: [past] });
    expect(styledBlocks(doc({ type: 'bulletList', content: [past] }), LIGHT_THEME).map((b) => b.runs.map((r) => r.text).join(''))).toEqual(['xy']);
  });

  it('NFR-REL-002: lists nested far past the depth limit are one block of their text, not a stack overflow', () => {
    let hostile: RichTextNode = p([t('far down')]);
    for (let i = 0; i < 40_000; i++) hostile = { type: 'bulletList', content: [item(hostile)] };
    const blocks = styledBlocks(doc(hostile), LIGHT_THEME);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.runs).toEqual([{ text: 'far down' }]);
  });
});
