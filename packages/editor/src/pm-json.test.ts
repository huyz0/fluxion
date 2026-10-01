import * as fc from 'fast-check';
import { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { fromPmJson, type PmNode, toPmJson } from './pm-json.js';
import { TEXT_SCHEMA } from './text-schema.js';

type Json = { [key: string]: unknown };

const text = fc.stringMatching(/^[a-z ]{1,6}$/);
const align = fc.constantFrom('left', 'center', 'right', 'justify');
const color = fc.constantFrom('#ff0000', '#00ff00', 'var(--fx-fg)');
const spacing = fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined });
const lineHeight = fc.option(fc.constantFrom(1, 1.2, 1.5, 2), { nil: undefined });

/** `attrs` with the undefined values left out, and none at all when empty. */
const withAttrs = (type: string, attrs: Json): Json => {
  const set = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
  return Object.keys(set).length > 0 ? { type, attrs: set } : { type };
};

const mark = fc.oneof(
  fc.constantFrom('bold', 'italic', 'underline', 'strike', 'code').map((type) => ({ type })),
  fc.record({ href: fc.constantFrom('https://a.example', 'mailto:b@c.d') }).map((attrs) => ({ type: 'link', attrs })),
  color.map((c) => ({ type: 'color', attrs: { color: c } })),
  fc.constantFrom(12, 24).map((size) => ({ type: 'size', attrs: { size } })),
  // a mark of a newer version, with attributes
  fc.record({ k: fc.integer() }).map((attrs) => ({ type: 'sparkle', attrs })),
);

/** Distinct marks by type (a text carries each type once). */
const marks = fc.uniqueArray(mark, { maxLength: 3, selector: (m) => m.type });

const leaf = fc.oneof(
  fc.record({ text, marks }).map((r) => ({ type: 'text', text: r.text, ...(r.marks.length > 0 ? { marks: r.marks } : {}) })),
  // text with a key of a newer version
  fc.record({ text, future: fc.integer() }).map(({ text: t, future }) => ({ type: 'text', text: t, future })),
  fc.constant({ type: 'hardBreak' }),
  fc.constantFrom('page', 'pages').map((name) => ({ type: 'field', attrs: { name } })),
  fc.constant({ type: 'emoji', attrs: { name: 'x' }, content: [{ type: 'text', text: 'smile' }] }),
);

const paragraph = fc
  .record({
    content: fc.array(leaf, { maxLength: 4 }),
    align: fc.option(align, { nil: undefined }),
    lineHeight,
    spaceBefore: spacing,
    spaceAfter: spacing,
    future: fc.option(fc.integer(), { nil: undefined }),
  })
  .map(({ content, future, ...attrs }) => ({
    ...withAttrs('paragraph', { ...attrs, ...(future === undefined ? {} : { newer: future }) }),
    ...(content.length > 0 ? { content } : {}),
  }));

const heading = fc
  .record({
    level: fc.integer({ min: 1, max: 6 }),
    content: fc.array(leaf, { minLength: 1, maxLength: 3 }),
    lineHeight,
    spaceBefore: spacing,
    spaceAfter: spacing,
  })
  .map(({ content, ...attrs }) => ({ ...withAttrs('heading', attrs), content }));

const item = paragraph.map((p) => ({ type: 'listItem', content: [p] }));
const list = fc
  .tuple(fc.constantFrom('bulletList', 'orderedList'), fc.array(item, { minLength: 1, maxLength: 3 }))
  .map(([type, content]) => ({ type, content }));
// a block of a newer version, whole
const future = fc.constant({ type: 'callout', attrs: { tone: 'warn' }, content: [{ type: 'text', text: 'beware' }] });

const doc = fc.array(fc.oneof(paragraph, heading, list, future), { minLength: 1, maxLength: 4 }).map((content) => ({ type: 'doc', content }));

/** Adjacent text nodes that differ only in their text, as one (the editor joins them). */
const joined = (nodes: readonly unknown[]): unknown[] =>
  nodes.reduce<Json[]>((out, n) => {
    const last = out[out.length - 1];
    const cur = n as Json;
    const same = (a: Json, b: Json) => JSON.stringify({ ...a, text: 0 }) === JSON.stringify({ ...b, text: 0 });
    if (last !== undefined && last['type'] === 'text' && cur['type'] === 'text' && same(last, cur)) last['text'] = String(last['text']) + String(cur['text']);
    else out.push({ ...cur });
    return out;
  }, []);

/** A stored document as the editor sees it: marks a set (their order is not kept), adjacent equal text joined. */
const settle = (n: unknown): unknown => {
  if (Array.isArray(n)) return joined(n.map(settle));
  if (typeof n !== 'object' || n === null) return n;
  const entries = Object.entries(n as Json).map(([k, v]) => [
    k,
    k === 'marks' && Array.isArray(v) ? [...v].map(settle).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : settle(v),
  ]);
  return Object.fromEntries(entries);
};

describe('pm-json', () => {
  it('FR-TXT-003: a stored document loaded into the editor and saved again is the same document', () => {
    fc.assert(
      fc.property(doc, (stored) => {
        const pm = Node.fromJSON(TEXT_SCHEMA, toPmJson(stored));
        pm.check();
        const saved = fromPmJson(pm.toJSON() as PmNode);
        expect(settle(saved)).toEqual(settle(stored));
        // a second round is byte-identical
        const again = fromPmJson(Node.fromJSON(TEXT_SCHEMA, toPmJson(saved)).toJSON() as PmNode);
        expect(JSON.stringify(again)).toBe(JSON.stringify(saved));
      }),
      { numRuns: 300 },
    );
  });

  it('FR-TXT-003: an empty or absent document gets one empty paragraph to put the cursor in', () => {
    for (const empty of [undefined, null, {}, { type: 'doc' }, { type: 'doc', content: [] }]) {
      expect(toPmJson(empty)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    }
  });

  it('FR-DOC-005: a block of a newer version is kept whole and shown as its text', () => {
    const callout = { type: 'callout', attrs: { tone: 'warn' }, content: [{ type: 'text', text: 'beware' }] };
    const node = Node.fromJSON(TEXT_SCHEMA, toPmJson({ type: 'doc', content: [callout] }));
    expect(node.textContent).toBe('');
    expect(fromPmJson(node.toJSON() as PmNode)).toEqual({ type: 'doc', content: [callout] });
  });

  it('FR-TXT-003: a list item that starts with something other than a paragraph keeps it whole', () => {
    const odd = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }] }],
    };
    const node = Node.fromJSON(TEXT_SCHEMA, toPmJson({ type: 'doc', content: [odd] }));
    node.check();
    expect(fromPmJson(node.toJSON() as PmNode)).toEqual({ type: 'doc', content: [odd] });
  });
  it('FR-TXT-003: the attributes the schema declares sit at the top of the editor`s JSON, the rest in `extra`', () => {
    const stored = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, align: 'center', lineHeight: 1.5, spaceBefore: 4, spaceAfter: 6, tone: 'x' },
          content: [
            {
              type: 'text',
              text: 'T',
              marks: [
                { type: 'link', attrs: { href: 'https://a.example', title: 'a', rel: 'me' } },
                { type: 'color', attrs: { color: 'red' } },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'field', attrs: { name: 'page' } }, { type: 'hardBreak' }, { type: 'text', text: 'x', future: 1 }] },
              ],
            },
          ],
        },
      ],
    };
    const pm = toPmJson(stored);
    expect(pm).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, align: 'center', lineHeight: 1.5, spaceBefore: 4, spaceAfter: 6, extra: { attrs: { tone: 'x' } } },
          content: [
            {
              type: 'text',
              text: 'T',
              marks: [
                { type: 'link', attrs: { href: 'https://a.example', title: 'a', extra: { attrs: { rel: 'me' } } } },
                { type: 'color', attrs: { color: 'red' } },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'field', attrs: { name: 'page' } },
                    { type: 'hardBreak' },
                    { type: 'text', text: 'x', marks: [{ type: 'unknownMark', attrs: { original: { type: '$extra', keys: { future: 1 } } } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(fromPmJson(pm)).toEqual(stored);
  });

  it('FR-TXT-003: text with nothing in it is dropped, and a node of the wrong place is kept whole', () => {
    const stray = { type: 'listItem', content: [{ type: 'paragraph' }] };
    const pm = toPmJson({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '' }, { type: 'text' }, { type: 'text', text: 'a' }] },
        stray,
        { type: 'bulletList', content: [{ type: 'paragraph' }] },
      ],
    });
    expect(pm.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'a' }] });
    expect(pm.content?.[1]).toEqual({ type: 'unknownBlock', attrs: { original: stray } });
    expect(pm.content?.[2]).toEqual({ type: 'bulletList', content: [{ type: 'unknownBlock', attrs: { original: { type: 'paragraph' } } }] });
    expect(
      toPmJson({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'x' }, 7, null, { type: 'emoji' }] }] }).content?.[0]?.content?.map(
        (n) => n.type,
      ),
    ).toEqual(['unknownInline', 'unknownInline']);
  });

  it('FR-TXT-003: an empty paragraph, a document without content and a list item first block that is not a paragraph are saved as they were', () => {
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, { type: 'heading', attrs: { level: 1 } }] }] },
      ],
    };
    expect(fromPmJson(toPmJson(stored) as PmNode)).toEqual(stored);
    expect(fromPmJson({ type: 'doc' })).toEqual({ type: 'doc', content: [] });
  });
});
