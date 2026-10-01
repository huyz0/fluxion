import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId, RichTextDoc, RichTextMark } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { RichText } from './rich-text.js';
import { ScreenView } from './screen-view.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A document of one paragraph holding `text` with `marks`. */
const doc = (text: string, marks?: readonly RichTextMark[]): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks === undefined ? {} : { marks }) }] }],
});

async function draw(d: RichTextDoc | undefined) {
  await act(async () => root.render(<RichText doc={d} />));
  return host;
}

/** The marks, each with a sample and what a browser computes for it. */
const MARKS: ReadonlyArray<{
  readonly name: string;
  readonly marks: readonly RichTextMark[];
  readonly check: (run: HTMLElement) => void;
}> = [
  { name: 'bold', marks: [{ type: 'bold' }], check: (el) => expect(getComputedStyle(el).fontWeight).toBe('700') },
  { name: 'italic', marks: [{ type: 'italic' }], check: (el) => expect(getComputedStyle(el).fontStyle).toBe('italic') },
  { name: 'underline', marks: [{ type: 'underline' }], check: (el) => expect(getComputedStyle(el).textDecorationLine).toBe('underline') },
  { name: 'strike', marks: [{ type: 'strike' }], check: (el) => expect(getComputedStyle(el).textDecorationLine).toBe('line-through') },
  { name: 'color', marks: [{ type: 'color', attrs: { color: '#336699' } }], check: (el) => expect(getComputedStyle(el).color).toBe('rgb(51, 102, 153)') },
  {
    name: 'highlight',
    marks: [{ type: 'highlight', attrs: { color: '#ffee00' } }],
    check: (el) => expect(getComputedStyle(el).backgroundColor).toBe('rgb(255, 238, 0)'),
  },
  { name: 'size', marks: [{ type: 'size', attrs: { size: 30 } }], check: (el) => expect(getComputedStyle(el).fontSize).toBe('30px') },
  { name: 'font', marks: [{ type: 'font', attrs: { family: 'Georgia' } }], check: (el) => expect(getComputedStyle(el).fontFamily).toBe('Georgia') },
  { name: 'code', marks: [{ type: 'code' }], check: (el) => expect(getComputedStyle(el).fontFamily).toContain('monospace') },
  {
    name: 'link',
    marks: [{ type: 'link', attrs: { href: 'https://example.com/a', title: 'Example' } }],
    check: (el) =>
      expect([el.tagName, el.getAttribute('href'), el.getAttribute('title'), el.getAttribute('rel')]).toEqual([
        'A',
        'https://example.com/a',
        'Example',
        'noopener noreferrer',
      ]),
  },
];

describe('rich-text marks (FR-TXT-001)', () => {
  for (const { name, marks, check } of MARKS) {
    it(`FR-TXT-001: the ${name} mark matches its golden`, async () => {
      await draw(doc('Sample', marks));
      // the markup is the golden; what a browser makes of it is checked beside it
      await expect(host.innerHTML).toMatchFileSnapshot(`../__golden__/rich-text/mark-${name}.html`);
      check(host.querySelector('p > *') as HTMLElement);
    });
  }

  it('FR-TXT-001: marks on one text nest in a fixed order whatever order they are stored in', async () => {
    const marks: RichTextMark[] = [
      { type: 'font', attrs: { family: 'Georgia' } },
      { type: 'bold' },
      { type: 'link', attrs: { href: 'https://example.com' } },
      { type: 'italic' },
    ];
    await draw(doc('Both', marks));
    const first = host.innerHTML;
    await draw(doc('Both', [...marks].reverse()));
    expect(host.innerHTML).toBe(first);
    expect(host.querySelector('p > a > strong > em > span')?.textContent).toBe('Both');
  });

  it('FR-TXT-001: a paragraph keeps its runs, line breaks and unmarked text; an absent or empty document draws no paragraph', async () => {
    await draw({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'next' },
          ],
        },
        { type: 'paragraph' },
      ],
    });
    expect([...host.querySelectorAll('p')].map((p) => p.innerHTML)).toEqual(['plain <strong>bold</strong><br>next', '']);
    expect((await draw(undefined)).querySelectorAll('p')).toHaveLength(0);
    expect((await draw({ type: 'doc' })).querySelectorAll('p')).toHaveLength(0);
  });

  it('FR-TXT-001: a javascript: link renders as plain text', async () => {
    await draw(doc('click me', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }]));
    expect(host.querySelector('a')).toBeNull();
    expect(host.innerHTML).not.toContain('javascript');
    // the rest of its marks still draw
    expect(host.querySelector('p > strong')?.textContent).toBe('click me');
  });

  it('NFR-SEC-001: a mark`s text is text: markup in it is escaped, never parsed', async () => {
    await draw(doc('<img src=x onerror=alert(1)>', [{ type: 'bold' }]));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

/** A document with one `text` element holding `text`. */
function textDocument(text: RichTextDoc): { readonly file: DocumentFile; readonly screenId: RecordId; readonly id: RecordId } {
  const b = documentBuilder({ seed: 78 });
  const screenId = b.screen({ size: { w: 400, h: 300 } });
  const rect = b.rect(screenId, { x: 20, y: 30, w: 200, h: 60 });
  const file = b.build();
  const records = structuredClone(file.records) as Record<string, Record<string, unknown>>;
  const el = records[rect as string] as Record<string, unknown>;
  records[rect as string] = { ...el, kind: 'text', text };
  delete (records[rect as string] as Record<string, unknown>)['defId'];
  return { file: { ...file, records } as DocumentFile, screenId, id: rect };
}

describe('text elements (FR-EDT-007)', () => {
  it("FR-EDT-007: a kind 'text' element is drawn, not a placeholder", async () => {
    const { file, screenId, id } = textDocument(doc('Hello world', [{ type: 'bold' }]));
    const core = createCore(file);
    await act(async () =>
      root.render(
        <ScreenView store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 300 } }} registries={builtinRegistries()} />,
      ),
    );
    const wrapper = host.querySelector<HTMLElement>(`.fx-el[data-el-id="${id}"]`);
    expect(wrapper?.dataset['kind']).toBe('text');
    expect(wrapper?.querySelector('.fx-placeholder')).toBeNull();
    expect(wrapper?.querySelector('.fx-text strong')?.textContent).toBe('Hello world');
    expect(getComputedStyle(wrapper?.querySelector('.fx-text') as HTMLElement).fontFamily).not.toBe('');
  });
});
