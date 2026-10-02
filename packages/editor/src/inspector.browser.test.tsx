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

// typing into a real browser through the whole editor: a loaded runner (or the full suite in parallel) needs more than the default 15 s
describe('inspector widgets (FR-EDT-008)', { timeout: 60_000 }, () => {
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
    input(inspector, 'Width').select();
    await userEvent.keyboard('250{Enter}');
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([250, 250, 250]);
    // text that is no number: the box shows the stored value again, nothing is written
    const steps = core.store.history.canUndo();
    await userEvent.click(input(inspector, 'Width'));
    input(inspector, 'Width').select();
    await userEvent.keyboard('abc{Enter}');
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
    const grow = inspector.querySelector('button[aria-label="grow"]') as HTMLElement;
    await userEvent.click(grow);
    await act(frame);
    expect((core.store.get(ids[0] as RecordId) as unknown as { textFit: { mode: string } }).textFit.mode).toBe('grow');
    expect([...inspector.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'))).toContain('grow');
  });

  it('FR-EDT-008: an enum field shows an icon per option', async () => {
    const { session, ids, inspector } = await open();
    await act(async () => session.selection.set([ids[0] as RecordId]));
    await act(frame);
    const fit = inspector.querySelector('fieldset[aria-label="Fit"]') as HTMLElement;
    const buttons = [...fit.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['none', 'shrink', 'grow']);
    // an icon, not the option's name: the name is the accessible name and the tooltip
    for (const b of buttons) {
      expect(b.textContent).not.toBe(b.getAttribute('aria-label'));
      expect(b.textContent?.length).toBeGreaterThan(0);
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
    }
  });

  it('FR-EDT-008: a rejected entry is given back', async () => {
    const { core, session, ids, inspector } = await open();
    await act(async () => session.selection.set([ids[0] as RecordId]));
    await act(frame);
    const steps = core.store.history.canUndo();
    const field = input(inspector, 'Fill value');
    await userEvent.click(field);
    field.select();
    await userEvent.keyboard('this is not a colour (((){Enter}');
    await act(frame);
    // the document refused it: nothing was written and the box shows what is stored again
    expect(style(core, ids[0] as RecordId)['fill']).toBe('#ff0000');
    expect(input(inspector, 'Fill value').value).toBe('#ff0000');
    expect(core.store.history.canUndo()).toBe(steps);
  });

  it('FR-EDT-008: arrow keys step a number', async () => {
    const { core, ids, inspector } = await open();
    await userEvent.click(input(inspector, 'Width'));
    await userEvent.keyboard('{ArrowUp}');
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([101, 101, 101]);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([91, 91, 91]);
    // each key is one undo step
    core.store.history.undo();
    await act(frame);
    expect(ids.map((id) => box(core, id)['w'])).toEqual([101, 101, 101]);
  });

  it('FR-EDT-008: a gradient fill is shown as a gradient', async () => {
    const { core, session, ids, inspector } = await open();
    const gradient = {
      type: 'linear-gradient',
      angle: 0,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    await act(async () => core.execute('element.update', { id: ids[0], fields: { style: { fill: gradient } } }));
    await act(async () => session.selection.set([ids[0] as RecordId]));
    await act(frame);
    expect(input(inspector, 'Fill value').value).toBe('linear gradient');
    const preview = inspector.querySelector('.fx-chrome-paint-preview') as HTMLElement;
    expect(preview.getAttribute('data-paint')).toBe('gradient');
    expect(preview.style.background).toContain('linear-gradient');
    // leaving the box unchanged does not turn the gradient into the text shown
    const steps = core.store.history.canUndo();
    await userEvent.click(input(inspector, 'Fill value'));
    await userEvent.keyboard('{Tab}');
    await act(frame);
    expect(style(core, ids[0] as RecordId)['fill']).toEqual(gradient);
    expect(core.store.history.canUndo()).toBe(steps);
  });

  it('FR-EDT-008: a scrub started before a selection change does not carry into the new selection', async () => {
    const { core, session, ids, inspector } = await open();
    const label = () => [...inspector.querySelectorAll('.fx-chrome-field-label')].find((l) => l.textContent === 'Width') as HTMLElement;
    const fire = (type: string, x: number) => label().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: 5 }));
    await act(async () => {
      fire('pointerdown', 100);
      fire('pointermove', 140);
    });
    await act(async () => session.selection.set([ids[1] as RecordId]));
    await act(frame);
    // a new drag on the new selection is one step of its own that changes only that element
    await act(async () => {
      fire('pointerdown', 100);
      fire('pointermove', 180);
      fire('pointerup', 180);
    });
    await act(frame);
    // the first scrub took the three shapes to 110; this one is 20 steps more on the second, and its own undo step
    expect(box(core, ids[1] as RecordId)['w']).toBe(130);
    core.store.history.undo();
    await act(frame);
    expect(box(core, ids[1] as RecordId)['w']).toBe(110);
  });
});
