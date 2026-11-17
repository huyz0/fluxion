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

  it('FR-EDT-013: a parent re-render with a new onClose keeps focus and scroll where the person left them', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ command: `c${i}`, title: `Item ${i}` }));
    const closes: string[] = [];
    // one line per item, as the chrome styles them, so thirty overflow the menu's max height
    const style = document.createElement('style');
    style.textContent = '[role="menu"] { position: fixed; } [role="menuitem"] { display: block; height: 24px; }';
    document.head.append(style);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    // in the lower half of a window, so it opens upward with a max height and scrolls
    const at = { x: 20, y: Math.round(window.innerHeight * 0.6) };
    const render = (n: number) =>
      act(() => root.render(<ContextMenu items={many} at={at} keysOf={() => []} onPick={() => {}} onClose={() => closes.push(`close ${n}`)} />));
    render(1);
    const m = host.querySelector('[role="menu"]') as HTMLElement;
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
    key('End');
    const scrolled = m.scrollTop;
    expect(scrolled).toBeGreaterThan(0);
    render(2);
    expect(document.activeElement?.textContent).toBe('Item 29');
    expect(m.scrollTop).toBe(scrolled);
    // the press outside reaches the onClose of the latest render
    act(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(closes).toEqual(['close 2']);
    opener.remove();
    style.remove();
  });
});
