import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import type { ElementRecord, RecordId, RichTextDoc, TextElement } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EditorRoot } from './editor-root.js';
import { createSession } from './session.js';

let host: HTMLElement;
let root: Root;
beforeEach(async () => {
  await page.viewport(1280, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** A document with one `text` element (as a paste or an import makes) and an editor open on it. */
async function open(): Promise<{ core: ReturnType<typeof createCore>; session: ReturnType<typeof createSession>; id: RecordId }> {
  const b = documentBuilder({ seed: 71 });
  const screen = b.screen({ size: { w: 800, h: 600 } });
  const id = b.text(screen, 'Hello', { x: 100, y: 100, w: 300, h: 80 });
  const core = createCore(b.build());
  const session = createSession('t');
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
  );
  await act(frame);
  return { core, session, id };
}

const textOf = (core: ReturnType<typeof createCore>, id: RecordId): RichTextDoc => (core.store.get(id) as TextElement).text;
const plain = (doc: RichTextDoc): string =>
  JSON.stringify(doc)
    .match(/"text":"([^"]*)"/g)
    ?.map((m) => m.slice(8, -1))
    .join('') ?? '';

/** A double-click at the middle of `el`, as the canvas reads it (client coordinates). */
function doubleClick(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
}

describe('inline text editing (FR-TXT-003)', () => {
  it('FR-TXT-003: Enter opens a text element, typing and Esc write its text in one undo step', async () => {
    const { core, session, id } = await open();
    await act(async () => session.selection.set([id]));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await act(frame);
    expect(session.editing.get()).toBe(id);
    const editor = host.querySelector('[data-testid="text-editor"]') as HTMLElement;
    expect(editor).not.toBeNull();
    // the element's own label is hidden while it is edited, and the editor's text sits where it is drawn
    expect(editor.querySelector('.fx-chrome-textroot')?.textContent).toBe('Hello');
    await userEvent.keyboard('Bye');
    await userEvent.keyboard('{Escape}');
    await act(frame);
    expect(session.editing.get()).toBeUndefined();
    expect(host.querySelector('[data-testid="text-editor"]')).toBeNull();
    // the selected text was replaced; the stored text has the stored shape (a doc of paragraphs)
    expect(plain(textOf(core, id))).toBe('Bye');
    expect(core.store.history.canUndo()).toBe(true);
    core.store.history.undo();
    expect(plain(textOf(core, id))).toBe('Hello');
    expect(core.store.history.canUndo()).toBe(false);
  });

  it('FR-TXT-003: Esc with nothing typed writes nothing, and Enter does nothing with two elements selected', async () => {
    const { core, session, id } = await open();
    await act(async () => session.editing.set(id));
    await act(frame);
    await userEvent.keyboard('{Escape}');
    await act(frame);
    expect(core.store.history.canUndo()).toBe(false);
    const other = (core.store.get(id) as ElementRecord).id;
    await act(async () => session.selection.set([id, other]));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(session.editing.get()).toBeUndefined();
  });

  it('FR-TXT-003: the element deleted under the editor closes it, writing nothing', async () => {
    const { core, session, id } = await open();
    await act(async () => session.editing.set(id));
    await act(frame);
    await userEvent.keyboard('x');
    await act(async () => {
      core.execute('element.delete', { ids: [id] });
    });
    await act(frame);
    expect(session.editing.get()).toBeUndefined();
    expect(core.store.get(id)).toBeUndefined();
  });

  it('FR-ARR-001: a double-click on the text of a group enters the group first, and edits the text once inside it', async () => {
    const b = documentBuilder({ seed: 72 });
    const screen = b.screen({ size: { w: 800, h: 600 } });
    const text = b.text(screen, 'Hello', { x: 100, y: 100, w: 300, h: 80 });
    const shape = b.rect(screen, { x: 100, y: 300, w: 100, h: 100 });
    const core = createCore(b.build());
    expect(core.execute('element.group', { ids: [text, shape], groupId: 'TextGroup0000001' }).ok).toBe(true);
    const session = createSession('t');
    await act(async () =>
      root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
    );
    await act(frame);
    const label = host.querySelector(`.fx-el[data-el-id="${text}"]`) as HTMLElement;
    await act(async () => doubleClick(label));
    await act(frame);
    // outside the group the double-click enters it; the text is not opened
    expect(session.entered.get()).toBe('TextGroup0000001');
    expect(session.editing.get()).toBeUndefined();
    expect(session.selection.get()).toEqual([text]);
    // inside it, the same gesture opens the text
    await act(async () => doubleClick(label));
    await act(frame);
    expect(session.editing.get()).toBe(text);
    expect(session.entered.get()).toBe('TextGroup0000001');
  });
});
