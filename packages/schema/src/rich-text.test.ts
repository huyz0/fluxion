import { describe, expect, it } from 'vitest';
import { checkRichText, MAX_RICH_TEXT_DEPTH, richTextSchema } from './rich-text.js';

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('rich text (ADR-0013)', () => {
  it('FR-DOC-001: every node and mark of the subset validates', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2, align: 'center' }, content: [t('Title')] },
      p(
        t('b', [{ type: 'bold' }]),
        t('i', [{ type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'code' }]),
        t('link', [{ type: 'link', attrs: { href: 'https://example.com', title: 'x' } }]),
        t('mail', [{ type: 'link', attrs: { href: 'mailto:a@b.c' } }]),
        t('jump', [{ type: 'link', attrs: { href: '#screen:s2' } }]),
        t('c', [
          { type: 'color', attrs: { color: '#f00' } },
          { type: 'highlight', attrs: { color: '{color.accent}' } },
          { type: 'font', attrs: { family: 'Inter' } },
          { type: 'size', attrs: { size: 18 } },
        ]),
        { type: 'hardBreak' },
        { type: 'field', attrs: { name: 'page' } },
      ),
      p(),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(t('one')), { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('a'))] }] }] },
        ],
      },
    );
    expect(checkRichText(value)).toEqual([]);
    expect(richTextSchema.safeParse(value).success).toBe(true);
  });

  it('FR-DOC-004: an unknown mark yields exactly one warning with its path, and is kept', () => {
    const value = doc(p(t('x', [{ type: 'sparkle', attrs: { speed: 2 } }])));
    expect(checkRichText(value)).toEqual([
      expect.objectContaining({ code: 'FLX_TEXT_UNKNOWN_MARK', severity: 'warning', path: ['content', 0, 'content', 0, 'marks', 0] }),
    ]);
    expect(richTextSchema.parse(value)).toEqual(value);
  });

  it('FR-DOC-005: an unknown node is kept, warned once, and satisfies the content rules around it (M2.3 r2)', () => {
    const table = { type: 'table', attrs: { rows: 2 }, content: [{ type: 'row', content: [] }] };
    const value = doc(table, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'codeBlock', content: [t('x')] }] }] });
    const issues = checkRichText(value);
    expect(issues.map((i) => [i.code, i.severity, i.path.join('/')])).toEqual([
      ['FLX_TEXT_UNKNOWN_NODE', 'warning', 'content/0'],
      ['FLX_TEXT_UNKNOWN_NODE', 'warning', 'content/0/content/0'],
      ['FLX_TEXT_UNKNOWN_NODE', 'warning', 'content/1/content/0/content/0'],
    ]);
    expect(richTextSchema.parse(value)).toEqual(value);
  });

  it('NFR-SEC-001: a javascript: or data: link is an error', () => {
    for (const href of ['javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', 'vbscript:x', '//evil', 42]) {
      const issues = checkRichText(doc(p(t('x', [{ type: 'link', attrs: { href } }]))));
      expect(issues, String(href)).toEqual([expect.objectContaining({ code: 'FLX_TEXT_UNSAFE_LINK', severity: 'error' })]);
    }
    expect(richTextSchema.safeParse(doc(p(t('x', [{ type: 'link', attrs: { href: 'javascript:x' } }])))).success).toBe(false);
  });

  it('reports structural errors on known nodes with their paths, all of them', () => {
    const value = doc(
      { type: 'heading', content: [t('no level')] },
      t('text at block level'),
      p(p()),
      { type: 'bulletList', content: [p()] },
      { type: 'bulletList', content: [] },
      { type: 'orderedList', attrs: { start: 0 }, content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [] }] }] },
      p(t(''), { type: 'hardBreak', content: [] }, { type: 'field', attrs: { name: 'secret' } }),
      p(
        t('dup', [{ type: 'bold' }, { type: 'bold' }]),
        t('bad', [
          { type: 'size', attrs: { size: -1 } },
          { type: 'color', attrs: { color: 'nope' } },
        ]),
      ),
      p(t('x', [{ type: 'font', attrs: {} }]), t('y', 'notarray' as unknown as unknown[])),
      { type: 'paragraph', attrs: { align: 'middle' } },
      { type: 'paragraph', attrs: 3 },
      { type: 'paragraph', content: 'x' },
      42,
      { nope: true },
      p(t('m', [7])),
    );
    const paths = checkRichText(value)
      .filter((i) => i.severity === 'error')
      .map((i) => i.path.join('/'));
    expect(paths).toEqual([
      'content/0/attrs/level',
      'content/1',
      'content/2/content/0',
      'content/3/content/0',
      'content/4/content',
      'content/5/attrs/start',
      'content/5/content/0/content/0/content',
      'content/5/content/0/content/0',
      'content/6/content/0/text',
      'content/6/content/1/content',
      'content/6/content/2/attrs/name',
      'content/7/content/0/marks/1',
      'content/7/content/1/marks/0/attrs/size',
      'content/7/content/1/marks/1/attrs/color',
      'content/8/content/0/marks/0/attrs/family',
      'content/8/content/1/marks',
      'content/9/attrs/align',
      'content/10/attrs',
      'content/11/content',
      'content/12',
      'content/13',
      'content/14/content/0/marks/0',
    ]);
  });

  it('FR-TXT-001: a paragraph or heading may carry its own line height and the space around it; values out of range are errors at their paths', () => {
    const good = doc(
      { type: 'paragraph', attrs: { lineHeight: 1.5, spaceBefore: 0, spaceAfter: 12 }, content: [t('a')] },
      { type: 'heading', attrs: { level: 1, lineHeight: 0.5, spaceBefore: 400, spaceAfter: 400 }, content: [t('b')] },
    );
    expect(checkRichText(good)).toEqual([]);
    const bad = doc(
      { type: 'paragraph', attrs: { lineHeight: 4.5 } },
      { type: 'paragraph', attrs: { lineHeight: 0.4 } },
      { type: 'paragraph', attrs: { spaceBefore: -1 } },
      { type: 'heading', attrs: { level: 2, spaceAfter: 401 } },
      { type: 'paragraph', attrs: { spaceAfter: '12' } },
      { type: 'paragraph', attrs: { spaceBefore: Number.NaN } },
      { type: 'paragraph', attrs: { lineHeight: Number.POSITIVE_INFINITY } },
    );
    expect(checkRichText(bad)[0]?.message).toBe('lineHeight must be a number from 0.5 to 4');
    expect(checkRichText(bad)[2]?.message).toBe('spaceBefore must be a number from 0 to 400');
    expect(checkRichText(bad).map((i) => [i.code, i.path.join('/')])).toEqual([
      ['FLX_TEXT_INVALID', 'content/0/attrs/lineHeight'],
      ['FLX_TEXT_INVALID', 'content/1/attrs/lineHeight'],
      ['FLX_TEXT_INVALID', 'content/2/attrs/spaceBefore'],
      ['FLX_TEXT_INVALID', 'content/3/attrs/spaceAfter'],
      ['FLX_TEXT_INVALID', 'content/4/attrs/spaceAfter'],
      ['FLX_TEXT_INVALID', 'content/5/attrs/spaceBefore'],
      ['FLX_TEXT_INVALID', 'content/6/attrs/lineHeight'],
    ]);
  });

  it('NFR-REL-002: hostile nesting is an issue at the depth limit, not a stack overflow (M2.7 review F1)', () => {
    let node: unknown = p(t('deep'));
    for (let i = 0; i < 20_000; i++) node = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x')), node] }] };
    const issues = checkRichText(doc(node));
    // the paragraph and the nested list at the first level past the limit, nothing below
    expect(issues.map((i) => [i.code, i.path.length, i.message])).toEqual([
      ['FLX_TEXT_INVALID', 2 * (MAX_RICH_TEXT_DEPTH + 1), `rich text is nested deeper than ${MAX_RICH_TEXT_DEPTH} levels`],
      ['FLX_TEXT_INVALID', 2 * (MAX_RICH_TEXT_DEPTH + 1), `rich text is nested deeper than ${MAX_RICH_TEXT_DEPTH} levels`],
    ]);
    expect(richTextSchema.safeParse(doc(node)).success).toBe(false);
    let ok: unknown = p(t('ok'));
    for (let i = 0; i < 20; i++) ok = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x')), ok] }] };
    expect(checkRichText(doc(ok))).toEqual([]);
  });

  it('colour marks take a hex colour or a token, per ADR-0013 (M2.7 review F2)', () => {
    const mark = (type: string, color: unknown) => checkRichText(doc(p(t('x', [{ type, attrs: { color } }]))));
    expect(mark('color', '#3355ff')).toEqual([]);
    expect(mark('highlight', '{color.accent}')).toEqual([]);
    for (const bad of ['red', 'rgb(1 2 3)', { token: '{c.a}', transform: { alpha: 0.5 } }]) expect(mark('highlight', bad), JSON.stringify(bad)).toHaveLength(1);
  });

  it('checks the shape an unknown node exposes to renderers: content, text and marks (M2.7 review F2)', () => {
    const paths = (node: unknown) =>
      checkRichText(doc(node))
        .filter((i) => i.severity === 'error')
        .map((i) => i.path.join('/'));
    expect(paths({ type: 'table', content: 42 })).toEqual(['content/0/content']);
    expect(paths({ type: 'table', content: [5] })).toEqual(['content/0/content/0']);
    expect(paths({ type: 'table', text: 7, marks: 'bold' })).toEqual(['content/0/text', 'content/0/marks']);
    // known nodes inside an unknown node keep their own rules, wherever they sit
    expect(paths({ type: 'table', content: [{ type: 'heading', content: [] }, t('')] })).toEqual([
      'content/0/content/0/attrs/level',
      'content/0/content/1/text',
    ]);
    expect(paths({ type: 'table', content: [p(t('cell')), { type: 'row', content: [t('x', [{ type: 'bold' }])] }] })).toEqual([]);
  });

  it('a font mark family starting with "{" must be a valid token (M2.7 review F1)', () => {
    const family = (f: unknown) => checkRichText(doc(p(t('x', [{ type: 'font', attrs: { family: f } }])))).length;
    expect(family('{font.body}')).toBe(0);
    expect(family('Inter')).toBe(0);
    expect(family('{font.body')).toBe(1);
  });

  it('requires a doc root with blocks', () => {
    expect(checkRichText('hello')).toEqual([expect.objectContaining({ path: [], severity: 'error' })]);
    expect(checkRichText({ type: 'paragraph' })).toHaveLength(1);
    expect(checkRichText({ type: 'doc' })).toEqual([expect.objectContaining({ path: ['content'] })]);
    expect(checkRichText({ type: 'doc', content: [] })).toEqual([expect.objectContaining({ path: ['content'] })]);
    expect(richTextSchema.safeParse(null).success).toBe(false);
  });
});
