import type { RichTextDoc, RichTextNode } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { plainParagraphs } from './label.js';

const t = (text: string, marks?: RichTextNode['marks']): RichTextNode => ({ type: 'text', text, ...(marks === undefined ? {} : { marks }) });
const p = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const item = (...content: RichTextNode[]): RichTextNode => ({ type: 'listItem', content });
const doc = (...content: RichTextNode[]): RichTextDoc => ({ type: 'doc', content });

describe('the lines a label draws, for the measurer (FR-TXT-002)', () => {
  it('FR-TXT-002: a paragraph or heading is a line, with its runs joined; a hard break starts another', () => {
    expect(plainParagraphs(doc(p(t('one '), t('two', [{ type: 'bold' }])), { type: 'heading', attrs: { level: 2 }, content: [t('Title')] }))).toEqual([
      'one two',
      'Title',
    ]);
    expect(plainParagraphs(doc(p(t('a'), { type: 'hardBreak' }, t('b'), { type: 'hardBreak' }, { type: 'hardBreak' }, t('c'))))).toEqual(['a', 'b', '', 'c']);
    expect(plainParagraphs(doc(p(), { type: 'paragraph' }))).toEqual(['', '']);
    expect(plainParagraphs(doc(p({ type: 'hardBreak' })))).toEqual(['', '']);
  });

  it('FR-TXT-002: a field is the text it draws', () => {
    expect(plainParagraphs(doc(p(t('Page '), { type: 'field', attrs: { name: 'page' } }, t(' of '), { type: 'field', attrs: { name: 'pageCount' } })))).toEqual(
      ['Page {{page}} of {{pageCount}}'],
    );
  });

  it('FR-TXT-002: every item of a list, nested ones included, is a line of its own, in reading order', () => {
    const list = {
      type: 'bulletList',
      content: [item(p(t('one')), { type: 'orderedList', content: [item(p(t('inner a'))), item(p(t('inner b')))] }), item(p(t('two')))],
    };
    expect(plainParagraphs(doc(p(t('before')), list, p(t('after'))))).toEqual(['before', 'one', 'inner a', 'inner b', 'two', 'after']);
    expect(plainParagraphs(doc({ type: 'bulletList', content: [] }))).toEqual([]);
    // an item with two paragraphs is two lines
    expect(plainParagraphs(doc({ type: 'orderedList', content: [item(p(t('x')), p(t('y')))] }))).toEqual(['x', 'y']);
  });

  it('FR-TXT-002: a block this version does not know is one line of its text, as it is drawn; text at block level is a line', () => {
    expect(plainParagraphs(doc({ type: 'sparkle', content: [p(t('new ')), p(t('block'))] }))).toEqual(['new block']);
    expect(plainParagraphs(doc(t('bare')))).toEqual(['bare']);
  });

  it('NFR-REL-002: lists nested past the depth limit are one line of their text, not a stack overflow', () => {
    let deep: RichTextNode = p(t('bottom'));
    for (let i = 0; i < 40_000; i++) deep = { type: 'bulletList', content: [item(deep)] };
    expect(plainParagraphs(doc(deep))).toEqual(['bottom']);
    // within the limit every level is walked
    let shallow: RichTextNode = p(t('bottom'));
    for (let i = 0; i < 10; i++) shallow = { type: 'bulletList', content: [item(shallow, p(t(`level ${i}`)))] };
    expect(plainParagraphs(doc(shallow))).toHaveLength(11);
  });

  it('NFR-REL-002: a list is walked to the schema`s depth limit and no further', () => {
    // a list and its item are two levels: the item at level 64 is the last one whose children are walked
    let inner: RichTextNode = item(p(t('x')), p(t('y')));
    for (let i = 0; i < 31; i++) inner = item({ type: 'bulletList', content: [inner] });
    expect(plainParagraphs(doc({ type: 'bulletList', content: [inner] }))).toEqual(['x', 'y']);
    // one level deeper and the item is drawn as a single paragraph of its text
    let past: RichTextNode = item(p(t('x')), p(t('y')));
    past = item({ type: 'bulletList', content: [past] });
    for (let i = 0; i < 31; i++) past = item({ type: 'bulletList', content: [past] });
    expect(plainParagraphs(doc({ type: 'bulletList', content: [past] }))).toEqual(['xy']);
  });

  it('FR-TXT-002: a text node with no text (a document that was never validated) is an empty run', () => {
    expect(plainParagraphs(doc(p({ type: 'text' }, t('a'), { type: 'text' })))).toEqual(['a']);
  });

  it('FR-TXT-002: no document, or one without content, has no lines', () => {
    expect(plainParagraphs(undefined)).toEqual([]);
    expect(plainParagraphs({ type: 'doc' })).toEqual([]);
  });
});
