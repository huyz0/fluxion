import { createCore } from '@fluxion/core';
import { renderRegistriesFor } from '@fluxion/player';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorRoot } from './editor-root.js';
import { readOnly } from './present-mode.js';
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

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const key = (k: string, o: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
};

async function mount() {
  const b = documentBuilder({ seed: 190 });
  const screen = b.screen({ size: { w: 1000, h: 500 } });
  const rect = b.rect(screen, { x: 100, y: 100, w: 200, h: 100 });
  const core = createCore(b.build());
  const session = createSession('doc');
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
  );
  await act(frame);
  const editor = () => host.querySelector('[data-testid="editor-root"]') as HTMLElement;
  return { core, session, rect, editor };
}

describe('present in place (FR-EDT-009)', () => {
  it('FR-EDT-009: F5 presents the screen fitted, with no edit chrome; F5 or Esc returns with the tool put back', async () => {
    const { session, editor } = await mount();
    session.tool.set('hand');
    expect([editor().dataset['mode'], editor().dataset['revision']]).toEqual(['edit', '0']);
    // F5 would reload: it is taken
    expect(key('F5')).toBe(true);
    await act(frame);
    expect(editor().dataset['mode']).toBe('present');
    const stage = host.querySelector('[data-testid="present-in-place"]') as HTMLElement;
    expect(stage.querySelector('.fx-screen')).not.toBeNull();
    for (const chrome of ['.fx-chrome-toolbar', '.fx-chrome-overlay', '.fx-chrome-panel', 'main']) expect(host.querySelector(chrome)).toBeNull();
    expect(key('Escape')).toBe(true);
    await act(frame);
    expect([editor().dataset['mode'], session.tool.get()]).toEqual(['edit', 'hand']);
    // shift+F5 presents too; F5 returns; with ctrl it is not the switch
    key('F5', { shiftKey: true });
    expect(session.mode.get()).toBe('present');
    key('F5');
    expect(session.mode.get()).toBe('edit');
    expect(key('F5', { ctrlKey: true })).toBe(false);
    expect(session.mode.get()).toBe('edit');
    // the toolbar's Present button presents too
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Present') as HTMLButtonElement;
    expect([button.title, button.getAttribute('aria-keyshortcuts')]).toEqual(['Present (F5)', 'F5']);
    act(() => button.click());
    expect(session.mode.get()).toBe('present');
  });

  it('FR-EDT-003: while presenting, the pointer draws the laser trail over the screen and leaving the stage clears it', async () => {
    const { session } = await mount();
    key('F5');
    await act(frame);
    const stage = host.querySelector('[data-testid="present-in-place"]') as HTMLElement;
    const r = stage.getBoundingClientRect();
    const move = (x: number, y: number) =>
      act(() => {
        stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }));
      });
    // the stage's middle is the screen's middle (500, 250)
    move(r.width / 2, r.height / 2);
    await act(frame);
    const trail = session.laser.get();
    expect([Math.round(trail[0]?.x ?? 0), Math.round(trail[0]?.y ?? 0)]).toEqual([500, 250]);
    expect(stage.querySelectorAll('.fx-screen svg.fx-laser circle')).toHaveLength(1);
    act(() => {
      stage.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
    });
    expect([session.laser.get(), stage.querySelectorAll('svg.fx-laser')]).toEqual([[], expect.objectContaining({ length: 0 })]);
  });

  it('FR-EDT-009: while presenting, clicks, drags and edit keys change nothing', async () => {
    const { core, session, rect, editor } = await mount();
    act(() => void core.store.transact('named', (tx) => tx.patch(rect, { name: 'r' })));
    const before = core.store.toDocument();
    const revision = editor().dataset['revision'];
    expect(revision).toBe('1');
    key('F5');
    await act(frame);
    const stage = host.querySelector('[data-testid="present-in-place"]') as HTMLElement;
    const r = stage.getBoundingClientRect();
    const at = (type: string, x: number, y: number) =>
      act(() => {
        stage.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x, clientY: r.top + y }),
        );
      });
    at('pointerdown', r.width / 2, r.height / 2);
    at('pointermove', r.width / 2 + 50, r.height / 2 + 30);
    await act(frame);
    at('pointerup', r.width / 2 + 50, r.height / 2 + 30);
    for (const k of ['Delete', 'Backspace', 'ArrowLeft', 'r', 'v']) key(k);
    key('z', { ctrlKey: true });
    key('d', { ctrlKey: true });
    // L is the laser's key in present mode
    expect(key('l')).toBe(true);
    expect([core.store.toDocument(), editor().dataset['revision'], session.selection.get()]).toEqual([before, revision, []]);
    // and a command the present tools send is refused
    expect(readOnly('element.delete', { id: rect }).ok).toBe(false);
  });
});
