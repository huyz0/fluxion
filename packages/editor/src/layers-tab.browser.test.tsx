import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { LayersTab } from './layers-tab.js';
import { createSession } from './session.js';

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

/** Three rects back to front in the Layers tab. */
async function open() {
  const b = documentBuilder({ seed: 19141 });
  const s = b.screen();
  const ids = [0, 1, 2].map((i) => b.rect(s, { x: i * 50, y: 0, w: 40, h: 40 })) as [RecordId, RecordId, RecordId];
  const core = createCore(b.build());
  for (const [i, id] of ids.entries()) core.execute('element.update', { id, fields: { name: `R${i}` } });
  core.store.history.seal();
  const session = createSession('layers');
  await act(async () => root.render(<LayersTab store={core.store} session={session} execute={core.execute} screenId={s} />));
  const order = () => [...host.querySelectorAll('.fx-chrome-layer')].map((li) => li.getAttribute('data-layer-id'));
  const row = (id: RecordId) => host.querySelector(`[data-layer-id="${id}"]`) as HTMLLIElement;
  const button = (name: string) => host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
  const index = (id: RecordId) => (core.store.get(id) as unknown as { index: string }).index;
  return { core, session, ids, order, row, button, index };
}

/** A drag of `from` dropped on the upper or lower half of `to`. */
async function drop(from: HTMLElement, to: HTMLElement, upper: boolean) {
  const dataTransfer = new DataTransfer();
  const box = to.getBoundingClientRect();
  const clientY = upper ? box.top + 1 : box.bottom - 1;
  await act(async () => {
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
  });
  await act(async () => {
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  });
}

describe('the layers tab (FR-ARR-008, M19.14)', { timeout: 60_000 }, () => {
  it('FR-ARR-008: a dragged row changes z-order by a new index of only the moved record, as one undo step', async () => {
    const { core, ids, order, row, index } = await open();
    const [a, b, c] = ids;
    expect(order()).toEqual([c, b, a]);
    const before = ids.map(index);
    const depth = core.store.history.undoDepth;
    // the back one dropped on the upper half of the front one goes in front of it
    await drop(row(a), row(c), true);
    expect(order()).toEqual([a, c, b]);
    expect(ids.map(index).filter((k, i) => k !== before[i])).toEqual([index(a)]);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    await act(async () => core.store.history.undo());
    expect(order()).toEqual([c, b, a]);
    // the lower half of the back one: the very back
    await drop(row(c), row(a), false);
    expect(order()).toEqual([b, a, c]);
  });

  it('FR-ARR-008: the toggles set hidden and locks, each one undo step, and a click selects', async () => {
    const { core, session, ids, row, button } = await open();
    const [a, b] = ids;
    const depth = core.store.history.undoDepth;
    await userEvent.click(button('Hide R0'));
    expect(core.store.get(a)).toMatchObject({ hidden: true });
    expect(row(a).dataset['hidden']).toBe('true');
    expect(button('Hide R0').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(button('Lock R0'));
    expect(core.store.get(a)).toMatchObject({ locks: { position: true, size: true, rotation: true, select: true } });
    expect(core.store.history.undoDepth).toBe(depth + 2);
    await userEvent.click(button('Hide R0'));
    await userEvent.click(button('Lock R0'));
    expect(core.store.get(a)).not.toHaveProperty('hidden');
    expect(core.store.get(a)).not.toHaveProperty('locks');
    // a locked element is still selected from the panel; Shift adds
    await userEvent.click(button('Lock R0'));
    await userEvent.click(row(a).querySelector('.fx-chrome-layer-button') as HTMLButtonElement);
    expect(session.selection.get()).toEqual([a]);
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(row(b).querySelector('.fx-chrome-layer-button') as HTMLButtonElement);
    await userEvent.keyboard('{/Shift}');
    expect(session.selection.get()).toEqual([a, b]);
    expect(row(b).querySelector('.fx-chrome-layer-button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('FR-ARR-008: Alt+ArrowUp on a row brings its element forward one place', async () => {
    const { ids, order, row } = await open();
    const [a, b, c] = ids;
    (row(a).querySelector('.fx-chrome-layer-button') as HTMLButtonElement).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(order()).toEqual([c, a, b]);
  });
});
