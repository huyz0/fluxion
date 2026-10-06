// The context menu (FR-EDT-013, M7.25): a menu of editor commands at the point it was asked for (a right click, a
// finger held still). Up and Down move, Enter or Space runs, Esc or a press outside closes, and focus goes back to
// where it was.
import { t } from '@lingui/core/macro';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import type { MenuItem } from './context-menu-model.js';

/** Props of {@link ContextMenu}. */
export type ContextMenuProps = {
  /** The menu's lines. */
  readonly items: readonly MenuItem[];
  /** Where it opens, in client px. */
  readonly at: { readonly x: number; readonly y: number };
  /** The chords of a command as people read them, as the keymap has them now. */
  readonly keysOf: (command: string) => readonly string[];
  /** Run the chosen item (the menu has closed). */
  readonly onPick: (item: MenuItem) => void;
  /** Close it. */
  readonly onClose: () => void;
};

/** The index after `at` going `step` through `count` items, wrapping. */
const around = (at: number, step: number, count: number): number => (at + step + count) % count;

/** The vertical placement of a menu asked for at client y `y`: down from it, or up from it in the window's lower half. */
const placed = (y: number): CSSProperties =>
  y > window.innerHeight / 2
    ? { top: 'auto', bottom: window.innerHeight - y, maxHeight: Math.max(y - 8, 80) }
    : { top: y, maxHeight: Math.max(window.innerHeight - y - 8, 80) };

/** The menu. */
export function ContextMenu(props: ContextMenuProps): ReactNode {
  const { items, at, keysOf, onPick, onClose } = props;
  const menu = useRef<HTMLDivElement>(null);
  const buttons = () => [...(menu.current?.querySelectorAll('button') ?? [])];
  useEffect(() => {
    const before = document.activeElement;
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    // capture: a press the canvas takes still closes the menu
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      if (before instanceof HTMLElement) before.focus({ preventScroll: true });
    };
  }, [onClose]);
  const key = (e: KeyboardEvent<HTMLElement>) => {
    // the canvas's shortcuts and undo do not act behind the menu
    e.stopPropagation();
    const all = buttons();
    const now = all.indexOf(document.activeElement as HTMLButtonElement);
    const to: { readonly [key: string]: number } = {
      ArrowDown: around(now, 1, all.length),
      ArrowUp: around(now, -1, all.length),
      Home: 0,
      End: all.length - 1,
    };
    const target = to[e.key];
    if (target !== undefined) all[target]?.focus();
    if (e.key === 'Escape' || e.key === 'Tab') onClose();
    if (target !== undefined || e.key === 'Escape' || e.key === 'Tab' || e.key === 'F5') e.preventDefault();
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={t`Context menu`}
      className="fx-chrome-picker fx-chrome-menu"
      // a long menu scrolls inside the window rather than running off it; asked for in the lower half it opens upward
      style={{ left: at.x, transform: 'none', overflowY: 'auto', ...placed(at.y) }}
      onKeyDown={key}
    >
      {items.map((item) => (
        <button key={item.command} type="button" role="menuitem" className="fx-chrome-button fx-chrome-menuitem" onClick={() => onPick(item)}>
          <span>{item.title}</span>
          <kbd className="fx-chrome-kbd">{keysOf(item.command).join(', ')}</kbd>
        </button>
      ))}
    </div>
  );
}
