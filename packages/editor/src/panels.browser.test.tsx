import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, type EditorLayout } from './layout.js';
import { Inspector, LeftTabs, Timeline, Toolbar } from './panels.js';

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

function Harness(): ReactNode {
  const [l, setL] = useState(DEFAULT_LAYOUT);
  layout = l;
  return <Toolbar layout={l} onLayout={setL} />;
}

const buttons = () => [...host.querySelectorAll('button')];
const pressed = () => buttons().map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`);
const click = (el: Element | undefined) =>
  act(() => {
    (el as HTMLElement).click();
  });
const key = (el: Element, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(e);
  });
  return e.defaultPrevented;
};

describe('editor chrome panels (FR-EDT-001)', () => {
  it('FR-EDT-001: the toolbar has a pressed button per shown panel and one for focus mode', async () => {
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('header')?.className).toBe('fx-chrome-toolbar');
    expect(pressed()).toEqual(['Screens, library and layers:true', 'Inspector:true', 'Timeline:false', 'Focus mode:false']);
    click(buttons()[2]);
    click(buttons()[0]);
    expect(pressed()).toEqual(['Screens, library and layers:false', 'Inspector:true', 'Timeline:true', 'Focus mode:false']);
    click(buttons()[3]);
    expect(pressed()).toEqual(['Screens, library and layers:false', 'Inspector:false', 'Timeline:false', 'Focus mode:true']);
    // a panel's button leaves focus mode and shows it
    click(buttons()[1]);
    expect(layout.focus).toBe(false);
    expect(pressed()).toEqual(['Screens, library and layers:false', 'Inspector:true', 'Timeline:true', 'Focus mode:false']);
    click(buttons()[3]);
    click(buttons()[3]);
    expect(layout.focus).toBe(false);
  });

  it('FR-EDT-001: the left tabs select by click and by arrow keys, one tab in the tab order', async () => {
    await act(async () => root.render(<LeftTabs />));
    const tabs = () => [...host.querySelectorAll('[role="tab"]')] as HTMLElement[];
    const state = () => tabs().map((t) => `${t.textContent}:${t.getAttribute('aria-selected')}:${t.tabIndex}`);
    const panel = () => host.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Left panel');
    expect(state()).toEqual(['Screens:true:0', 'Library:false:-1', 'Layers:false:-1']);
    expect(panel().getAttribute('aria-labelledby')).toBe(tabs()[0]?.id);
    expect(panel().textContent).toBe('The screens of this document will be listed here.');
    expect(tabs().every((t) => t.getAttribute('aria-controls') === panel().id)).toBe(true);
    click(tabs()[2]);
    expect(state()).toEqual(['Screens:false:-1', 'Library:false:-1', 'Layers:true:0']);
    expect(panel().textContent).toBe('The layers of this screen will be listed here.');
    expect(key(tabs()[2] as HTMLElement, 'ArrowRight')).toBe(true);
    expect(state()[0]).toBe('Screens:true:0');
    expect(document.activeElement).toBe(tabs()[0]);
    key(tabs()[0] as HTMLElement, 'ArrowLeft');
    expect(state()[2]).toBe('Layers:true:0');
    key(tabs()[2] as HTMLElement, 'Home');
    expect(state()[0]).toBe('Screens:true:0');
    key(tabs()[0] as HTMLElement, 'End');
    key(tabs()[2] as HTMLElement, 'ArrowLeft');
    expect(state()[1]).toBe('Library:true:0');
    expect(panel().textContent).toBe('Shapes and components will be listed here.');
    expect(key(tabs()[1] as HTMLElement, 'ArrowDown')).toBe(false);
    expect(state()[1]).toBe('Library:true:0');
  });

  it('FR-EDT-001: the inspector and the timeline are titled placeholders', async () => {
    await act(async () =>
      root.render(
        <>
          <Inspector />
          <Timeline />
        </>,
      ),
    );
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Inspector', 'Timeline']);
    expect(host.querySelectorAll('p.fx-chrome-placeholder').length).toBe(2);
  });
});
