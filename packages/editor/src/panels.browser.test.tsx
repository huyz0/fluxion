import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { DEFAULT_LAYOUT, type EditorLayout } from './layout.js';
import { Inspector, LeftTabs, Timeline, ToolButtons, Toolbar } from './panels.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

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

  it('FR-EDT-003: a button per tool, titled with its shortcut and pressed while it is the tool', async () => {
    const session = createSession('doc');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const tools = createToolDispatcher(registry, {
      session,
      hitTest: () => undefined,
      elementsIn: () => [],
      allElements: () => [],
      view: {} as never,
      newId: () => 'new' as never,
      execute: () => ({ ok: true, value: undefined }),
      seal: () => {},
    });
    await act(async () => root.render(<ToolButtons session={session} tools={tools} />));
    const state = () => buttons().map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}:${b.title}:${b.getAttribute('aria-keyshortcuts')}`);
    expect(host.querySelector('fieldset')?.getAttribute('aria-label')).toBe('Tools');
    expect(state()).toEqual(['Hand:false:Hand (H):H', 'Select:true:Select (V):V']);
    click(buttons()[0]);
    expect([session.tool.get(), state()[0]]).toEqual(['hand', 'Hand:true:Hand (H):H']);
    // a tool without a shortcut is titled by its name alone
    registry.register('plain', { id: 'plain', title: 'Plain', initial: 'idle', states: { idle: { id: 'idle' } } }, 'test');
    await act(async () => root.render(<ToolButtons session={session} tools={tools} key="again" />));
    expect(state()[1]).toBe('Plain:false:Plain:null');
  });

  it('FR-EDT-001: the inspector and the timeline are titled placeholders', async () => {
    const session = createSession('doc');
    await act(async () =>
      root.render(
        <>
          <Inspector session={session} />
          <Timeline />
        </>,
      ),
    );
    expect([...host.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Inspector', 'Timeline']);
    expect(host.querySelectorAll('p.fx-chrome-placeholder').length).toBe(2);
    // the inspector says how much is selected
    const said = () => host.querySelector('p[aria-live]')?.textContent;
    expect(said()).toBe('Select an element to see its properties.');
    act(() => session.selection.set(['a' as never]));
    expect(said()).toBe('1 element selected');
    act(() => session.selection.set(['a' as never, 'b' as never]));
    expect(said()).toBe('2 elements selected');
  });
});
