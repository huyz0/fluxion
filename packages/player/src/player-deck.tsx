// The one-file player's deck (FR-FIL-002, FR-EXP-001; the full player is M11): the document's visible screens, one at a time, fitted into
// the window and drawn by the same <ScreenView> as the editor (FR-EDT-010), with the arrow, page, space and home/end keys to move.
// The deck draws no text of its own (ADR-0023). Keys are left to a focused link, button or field, to a key another handler took, and to key repeat.
import type { Store } from '@fluxion/core';
import { type AssetUrls, presentationOrder, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useElementBox } from './use-box.js';

/**
 * Props of {@link PlayerDeck}.
 *
 * @public
 */
export type PlayerDeckProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** The URLs images are drawn from, by asset id (keep it stable). */
  readonly assets?: AssetUrls;
};

/** The key that moves the deck, as a step: `1` forward, `-1` back, `'first'` and `'last'` for the ends, or nothing. */
const MOVES: { readonly [key: string]: 1 | -1 | 'first' | 'last' } = {
  ArrowRight: 1,
  ArrowDown: 1,
  PageDown: 1,
  ' ': 1,
  Enter: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageUp: -1,
  Backspace: -1,
  Home: 'first',
  End: 'last',
};

/** Whether `target` is something that takes the keys itself: a link, a button, a field. */
const interactive = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('a, button, input, textarea, select, summary, [contenteditable], [tabindex]:not([tabindex="-1"])') !== null;

/** The index after `key` from `current` among `count` screens, kept inside the deck; `current` when the key moves nothing. */
function moved(key: string, current: number, count: number): number {
  const move = MOVES[key];
  if (move === undefined) return current;
  if (move === 'first') return 0;
  if (move === 'last') return Math.max(0, count - 1);
  return Math.min(Math.max(0, count - 1), Math.max(0, current + move));
}

/**
 * The document presented screen by screen: the visible screens in order, the first one first, moved with the keyboard.
 *
 * @public
 */
export function PlayerDeck(props: PlayerDeckProps): ReactNode {
  const { store, registries, assets } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const screens = useValue(useMemo(() => store.query((view) => presentationOrder(view, false)), [store]));
  const [index, setIndex] = useState(0);
  const count = screens.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented || MOVES[e.key] === undefined || interactive(e.target)) return;
      e.preventDefault();
      setIndex((current) => moved(e.key, current, count));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);
  const shown = screens[Math.min(index, Math.max(0, count - 1))];
  return (
    <div
      ref={ref}
      className="fx-player"
      data-testid="player-deck"
      data-screen-index={Math.min(index, Math.max(0, count - 1))}
      style={{ position: 'fixed', inset: 0, background: '#000' }}
    >
      {shown === undefined || box.w === 0 ? null : (
        <ScreenView
          store={store}
          screenId={shown}
          mode="present"
          view={{ kind: 'fit', box }}
          registries={registries}
          {...(assets === undefined ? {} : { assets })}
        />
      )}
    </div>
  );
}
