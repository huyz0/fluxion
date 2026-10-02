import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextMenu } from './context-menu.js';

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

const items = [
  { command: 'a', title: 'Alpha' },
  { command: 'b', title: 'Beta' },
  { command: 'c', title: 'Gamma' },
];
const key = (k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  act(() => void document.activeElement?.dispatchEvent(e));
  return e;
};

function mount() {
  const log: string[] = [];
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  act(() =>
    root.render(
      <ContextMenu
        items={items}
        at={{ x: 20, y: 30 }}
        keysOf={(c) => (c === 'a' ? ['Ctrl+A', 'F2'] : [])}
        onPick={(i) => log.push(`pick ${i.command}`)}
        onClose={() => {
          log.push('close');
          act(() => root.render(null));
        }}
      />,
    ),
  );
  const menu = () => host.querySelector('[role="menu"]');
  const focused = () => document.activeElement?.querySelector('span')?.textContent;
  return { log, opener, menu, focused };
}

describe('context menu (FR-EDT-013)', () => {
  it('FR-EDT-013: it opens at the point with the first item focused and shows each item`s chords', () => {
    const { menu, focused, opener } = mount();
    const m = menu() as HTMLElement;
    expect([m.style.left, m.style.top, m.getAttribute('aria-label')]).toEqual(['20px', '30px', 'Context menu']);
    expect([...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['AlphaCtrl+A, F2', 'Beta', 'Gamma']);
    expect(focused()).toBe('Alpha');
    opener.remove();
  });

  it('FR-EDT-013: arrows move and wrap, Home and End jump, Enter picks, Esc closes and gives focus back; keys do not reach the canvas', () => {
    const { log, menu, focused, opener } = mount();
    const outside: string[] = [];
    window.addEventListener('keydown', (e) => outside.push(e.key));
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(focused()).toBe('Beta');
    key('ArrowDown');
    key('ArrowDown');
    expect(focused()).toBe('Alpha');
    key('ArrowUp');
    expect(focused()).toBe('Gamma');
    key('Home');
    expect(focused()).toBe('Alpha');
    key('End');
    expect(focused()).toBe('Gamma');
    key('x');
    expect(outside).toEqual([]);
    act(() => (document.activeElement as HTMLElement).click());
    expect(log).toEqual(['pick c']);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(log).toEqual(['pick c', 'close']);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('FR-EDT-013: a press outside closes it, a press inside does not', () => {
    const { log, menu, opener } = mount();
    const down = (target: EventTarget) => act(() => void target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    down(menu() as HTMLElement);
    expect(log).toEqual([]);
    down(document.body);
    expect(log).toEqual(['close']);
    expect(menu()).toBeNull();
    opener.remove();
  });
});
