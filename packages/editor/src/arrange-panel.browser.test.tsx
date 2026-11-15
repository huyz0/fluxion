import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import type { RecordId } from '@fluxion/schema';
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

/** Three rects of three widths (100, 200, 50) at uneven places, all selected in an editor. */
async function open() {
  const b = documentBuilder({ seed: 1913 });
  const s = b.screen({ size: { w: 1000, h: 600 } });
  const ids = [b.rect(s, { x: 10, y: 10, w: 100, h: 50 }), b.rect(s, { x: 150, y: 100, w: 200, h: 60 }), b.rect(s, { x: 700, y: 200, w: 50, h: 70 })];
  const core = createCore(b.build());
  const session = createSession('arrange');
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
  );
  await act(frame);
  await act(async () => session.selection.set(ids));
  await act(frame);
  const panel = host.querySelector('fieldset[aria-label="Arrange"]') as HTMLFieldSetElement;
  const x = (id: RecordId) => (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number } }).transform;
  const button = (name: string) => [...panel.querySelectorAll('button')].find((el) => el.textContent === name) as HTMLButtonElement;
  return { core, session, ids, panel, x, button };
}

describe('the arrange panel (FR-ARR-002, FR-ARR-003, M19.13)', { timeout: 60_000 }, () => {
  it('FR-ARR-002: picking a key object aligns the others to it, the key staying, as one undo step', async () => {
    const { core, ids, panel, x, button } = await open();
    const [a, b, c] = ids as [RecordId, RecordId, RecordId];
    const keyPick = panel.querySelector('select[aria-label="Align to"]') as HTMLSelectElement;
    // each choice is numbered in selection order, and named once the element has a name, following a rename
    expect([...keyPick.options].map((o) => o.text)).toEqual(['Selection', 'Key 1', 'Key 2', 'Key 3']);
    await act(async () => core.execute('element.update', { id: b, fields: { name: 'Hub' } }));
    expect(keyPick.options[2]?.text).toBe('Key 2: Hub');
    await userEvent.selectOptions(keyPick, b);
    const depth = core.store.history.undoDepth;
    await userEvent.click(button('Align left'));
    expect([x(a).x, x(b).x, x(c).x]).toEqual([150, 150, 150]);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    // to the selection's bounds instead: the right edges meet the rightmost (the wide one's, 150 + 200)
    await userEvent.selectOptions(keyPick, '');
    await userEvent.click(button('Align right'));
    expect([x(a).x + x(a).w, x(b).x + x(b).w, x(c).x + x(c).w]).toEqual([350, 350, 350]);
    core.store.history.undo();
    core.store.history.undo();
    expect([x(a).x, x(b).x, x(c).x]).toEqual([10, 150, 700]);
  });

  it('FR-ARR-003: distribute by centres spaces the centres evenly; tidy spaces the elements a typed gap apart; each one undo step', async () => {
    const { core, ids, panel, x, button } = await open();
    const [a, b, c] = ids as [RecordId, RecordId, RecordId];
    const centre = (id: RecordId) => x(id).x + x(id).w / 2;
    await userEvent.selectOptions(panel.querySelector('select[aria-label="Distribute by"]') as HTMLSelectElement, 'centers');
    const depth = core.store.history.undoDepth;
    await userEvent.click(button('Distribute horizontally'));
    // the outer centres (60, 725) stay; the middle one moves halfway
    expect([centre(a), centre(b), centre(c)]).toEqual([60, 392.5, 725]);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    const gap = panel.querySelector('input[aria-label="Tidy gap"]') as HTMLInputElement;
    await userEvent.clear(gap);
    await userEvent.type(gap, '15');
    await userEvent.click(button('Tidy across'));
    // the first stays at 10; each follows the one before 15 px after its right edge
    expect([x(a).x, x(b).x, x(c).x]).toEqual([10, 125, 340]);
    expect(core.store.history.undoDepth).toBe(depth + 2);
  });

  it('FR-ARR-007: with a key object, match width gives the others its width; one element selected shows no arrange panel', async () => {
    const { core, session, ids, panel, x, button } = await open();
    const [a, b, c] = ids as [RecordId, RecordId, RecordId];
    expect(button('Match width')).toBeUndefined();
    await userEvent.selectOptions(panel.querySelector('select[aria-label="Align to"]') as HTMLSelectElement, b);
    await userEvent.click(button('Match width'));
    expect([x(a).w, x(b).w, x(c).w]).toEqual([200, 200, 200]);
    core.store.history.undo();
    expect([x(a).w, x(c).w]).toEqual([100, 50]);
    await act(async () => session.selection.set([a]));
    await act(frame);
    expect(host.querySelector('fieldset[aria-label="Arrange"]')).toBeNull();
  });
});
