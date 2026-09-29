import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, type EditorLayout, type PanelId } from './layout.js';
import { Splitter } from './splitter.js';

let host: HTMLElement;
let root: Root;
let layout: EditorLayout;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness(props: { readonly panel: PanelId; readonly initial: EditorLayout }): ReactNode {
  const [l, setL] = useState(props.initial);
  layout = l;
  return <Splitter panel={props.panel} label="Resize it" controls={l.panels[props.panel].collapsed ? undefined : 'p'} layout={l} onLayout={setL} />;
}

const mount = async (panel: PanelId, initial: EditorLayout = DEFAULT_LAYOUT) => {
  await act(async () => root.render(<Harness panel={panel} initial={initial} />));
  return host.querySelector('[role="separator"]') as HTMLElement;
};

const key = (el: HTMLElement, k: string, shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(e);
  });
  return e.defaultPrevented;
};

const pointer = (el: HTMLElement, type: string, [x, y]: readonly [number, number], init: PointerEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, cancelable: true, ...init }));
  });

describe('Splitter (FR-EDT-001, ADR-0029)', () => {
  it('FR-EDT-001: a splitter is a named, focusable separator whose value is its panel`s size', async () => {
    const s = await mount('left');
    expect([s.tabIndex, s.getAttribute('aria-label'), s.getAttribute('aria-controls')]).toEqual([0, 'Resize it', 'p']);
    expect(['aria-orientation', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax'].map((a) => s.getAttribute(a))).toEqual(['vertical', '240', '0', '480']);
    expect(s.className).toBe('fx-chrome-splitter');
    const b = await mount('bottom');
    // the timeline starts collapsed: its splitter reads 0 and controls nothing
    expect([b.getAttribute('aria-orientation'), b.getAttribute('aria-valuenow'), b.hasAttribute('aria-controls')]).toEqual(['horizontal', '0', false]);
  });

  it('FR-EDT-001: arrows, Home, End and Enter resize and collapse; other keys pass through', async () => {
    const s = await mount('left');
    expect(key(s, 'ArrowRight')).toBe(true);
    expect(s.getAttribute('aria-valuenow')).toBe('250');
    key(s, 'ArrowLeft', true);
    expect(layout.panels.left.size).toBe(200);
    key(s, 'End');
    expect(s.getAttribute('aria-valuenow')).toBe('480');
    key(s, 'Enter');
    expect(layout.panels.left).toEqual({ size: 480, collapsed: true });
    expect(s.getAttribute('aria-valuenow')).toBe('0');
    expect(key(s, 'Tab')).toBe(false);
    expect(layout.panels.left).toEqual({ size: 480, collapsed: true });
  });

  it('FR-EDT-001: a drag moves the panel`s edge while the pointer is held, and only the primary button starts one', async () => {
    const s = await mount('right');
    pointer(s, 'pointerdown', [500, 10], { button: 2 });
    pointer(s, 'pointermove', [400, 10]);
    expect(layout.panels.right.size).toBe(280);
    pointer(s, 'pointerdown', [500, 10]);
    expect(s.className).toBe('fx-chrome-splitter fx-chrome-dragging');
    pointer(s, 'pointermove', [460, 90]);
    expect(layout.panels.right.size).toBe(320);
    // another pointer neither moves nor ends the drag
    pointer(s, 'pointermove', [0, 0], { pointerId: 7 });
    pointer(s, 'pointerup', [0, 0], { pointerId: 7 });
    expect([layout.panels.right.size, s.className]).toEqual([320, 'fx-chrome-splitter fx-chrome-dragging']);
    pointer(s, 'pointermove', [1000, 0]);
    expect(layout.panels.right.size).toBe(200);
    pointer(s, 'pointerup', [1000, 0]);
    expect(s.className).toBe('fx-chrome-splitter');
    pointer(s, 'pointermove', [100, 0]);
    expect(layout.panels.right.size).toBe(200);
  });

  it('FR-EDT-001: dragging a collapsed timeline opens it from nothing; a cancelled drag ends', async () => {
    const s = await mount('bottom');
    pointer(s, 'pointerdown', [10, 500]);
    pointer(s, 'pointermove', [10, 380]);
    expect(layout.panels.bottom).toEqual({ size: 120, collapsed: false });
    pointer(s, 'pointercancel', [10, 380]);
    pointer(s, 'pointermove', [10, 0]);
    expect([layout.panels.bottom.size, s.className]).toEqual([120, 'fx-chrome-splitter']);
  });
});
