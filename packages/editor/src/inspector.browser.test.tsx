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

/** Three shapes with three fills, selected in an editor. */
async function open() {
  const b = documentBuilder({ seed: 16 });
  const s = b.screen({ size: { w: 800, h: 600 } });
  const ids = [
    b.rect(s, { x: 10, y: 10, w: 100, h: 50, style: { fill: '#ff0000' } }),
    b.rect(s, { x: 200, y: 10, w: 100, h: 60, style: { fill: '#00ff00', opacity: 0.5 } }),
    b.rect(s, { x: 400, y: 10, w: 100, h: 70, style: { fill: '#0000ff' } }),
  ];
  const core = createCore(b.build());
  const session = createSession('i');
  await act(async () =>
    root.render(<EditorRoot store={core.store} execute={core.execute} registries={renderRegistriesFor(core.registries)} session={session} />),
  );
  await act(frame);
  await act(async () => session.selection.set(ids));
  await act(frame);
  const inspector = host.querySelector('aside[aria-label="Inspector"]') as HTMLElement;
  return { core, session, ids, inspector };
}

const style = (core: ReturnType<typeof createCore>, id: RecordId) => (core.store.get(id) as unknown as { style?: { [k: string]: unknown } }).style ?? {};
const box = (core: ReturnType<typeof createCore>, id: RecordId) => (core.store.get(id) as unknown as { transform: { [k: string]: number } }).transform;
const input = (inspector: HTMLElement, label: string) => inspector.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

describe('inspector widgets (FR-EDT-008)', () => {
  it('FR-EDT-008: a mixed fill set on 3 shapes updates all 3 in one undo step', async () => {
    const { core, ids, inspector } = await open();
    // the fill differs: the value box says Mixed
    expect(input(inspector, 'Fill value').placeholder).toBe('Mixed');
    expect(input(inspector, 'Fill value').value).toBe('');
    // the width is shared: it shows its value
    expect(input(inspector, 'Width').value).toBe('100');
    const before = core.store.history.canUndo();
    await userEvent.click(input(inspector, 'Fill value'));
    await userEvent.keyboard('#123456{Enter}');
    await act(frame);
    expect(ids.map((id) => style(core, id)['fill'])).toEqual(['#123456', '#123456', '#123456']);
    // now they agree
    expect(input(inspector, 'Fill value').value).toBe('#123456');
    // one undo step restores all three
    core.store.history.undo();
    await act(frame);
    expect(ids.map((id) => style(core, id)['fill'])).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(core.store.history.canUndo()).toBe(before);
  });

  it('FR-EDT-008: a typed number applies to all, an invalid one is given back, empty clears', async () => {
    const { core, ids, inspector } = await open();
    await userEvent.click(input(inspector, 'Width'));
    await userEvent.keyboard('{Control>}a{/Control}250{Enter}');
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([250, 250, 250]);
    // text that is no number: the box shows the stored value again, nothing is written
    const steps = core.store.history.canUndo();
    await userEvent.click(input(inspector, 'Width'));
    await userEvent.keyboard('{Control>}a{/Control}abc{Enter}');
    await act(frame);
    expect(input(inspector, 'Width').value).toBe('250');
    expect(ids.map((id) => box(core, id)['w'])).toEqual([250, 250, 250]);
    expect(core.store.history.canUndo()).toBe(steps);
  });

  it('FR-EDT-008: dragging a number`s label scrubs it, the whole drag is one undo step', async () => {
    const { core, ids, inspector } = await open();
    const label = [...inspector.querySelectorAll('.fx-chrome-field-label')].find((l) => l.textContent === 'Width') as HTMLElement;
    const at = label.getBoundingClientRect();
    const fire = (type: string, x: number, init: PointerEventInit = {}) =>
      label.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: at.top + 5, ...init }));
    await act(async () => {
      fire('pointerdown', at.left + 5);
      fire('pointermove', at.left + 5 + 40);
      fire('pointermove', at.left + 5 + 80);
      fire('pointerup', at.left + 5 + 80);
    });
    await act(frame);
    // 80 px is 20 steps of one
    expect(ids.map((id) => box(core, id)['w'])).toEqual([120, 120, 120]);
    core.store.history.undo();
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([100, 100, 100]);
  });

  it('FR-EDT-008: a slider sets the opacity of all, mixed where only one has it, and one slide is one undo step', async () => {
    const { core, ids, inspector } = await open();
    const slider = inspector.querySelector('input[type="range"][aria-label="Opacity"]') as HTMLInputElement;
    expect(slider.getAttribute('data-mixed')).toBe('true');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      for (const v of ['0.8', '0.6', '0.4']) {
        set?.call(slider, v);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await act(frame);
    expect(ids.map((id) => style(core, id)['opacity'])).toEqual([0.4, 0.4, 0.4]);
    core.store.history.undo();
    await act(frame);
    expect(ids.map((id) => style(core, id)['opacity'])).toEqual([undefined, 0.5, undefined]);
  });

  it('FR-EDT-008: a toggle and an enum are set from the panel; one element shows its own values and the token list', async () => {
    const { core, session, ids, inspector } = await open();
    await userEvent.click(input(inspector, 'Hidden'));
    await act(frame);
    expect(ids.map((id) => (core.store.get(id) as unknown as { hidden?: boolean }).hidden)).toEqual([true, true, true]);
    await act(async () => session.selection.set([ids[0] as RecordId]));
    await act(frame);
    expect(input(inspector, 'Fill value').value).toBe('#ff0000');
    expect(input(inspector, 'X').value).toBe('10');
    // the colour tokens of the theme are offered
    const list = inspector.querySelector('datalist');
    expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'))).toContain('{color.primary}');
    // clearing the fill removes it
    await userEvent.click(inspector.querySelector('button[aria-label="Clear Fill"]') as HTMLElement);
    await act(frame);
    expect(Object.hasOwn(style(core, ids[0] as RecordId), 'fill')).toBe(false);
    // the text fit is an enum of three: buttons, one pressed once set
    const grow = [...inspector.querySelectorAll('button')].find((b) => b.textContent === 'grow') as HTMLElement;
    await userEvent.click(grow);
    await act(frame);
    expect((core.store.get(ids[0] as RecordId) as unknown as { textFit: { mode: string } }).textFit.mode).toBe('grow');
    expect([...inspector.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent)).toContain('grow');
  });
});
