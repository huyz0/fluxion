// The deck's overview grid (FR-PRS-002): every visible screen as a small drawing of itself, in presentation order, each a button that goes to it. It opens over
// the deck, keeps focus inside while it is open, and gives focus back when it closes. The names are for assistive technology only (the deck draws no text, ADR-0023).

import type { Store } from '@fluxion/core';
import { type AssetUrls, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef } from 'react';
import { ScreenBoundary } from './screen-boundary.js';

/** The size each thumbnail is drawn in, in CSS pixels. */
const THUMB = { w: 240, h: 135 } as const;

/** Props of {@link DeckOverview}. */
type DeckOverviewProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** The URLs images are drawn from, by asset id (keep it stable). */
  readonly assets?: AssetUrls;
  /** The visible screens in presentation order. */
  readonly screens: readonly RecordId[];
  /** The screen the deck shows now, marked in the grid. */
  readonly current: RecordId | undefined;
  /** A screen was chosen. */
  readonly onPick: (screen: RecordId) => void;
  /** The grid was asked to close (Escape, `O`). */
  readonly onClose: () => void;
};

/** The index of the button to focus after `key` from `from`, or `undefined` when `key` is not a move in the grid. */
function target(key: string, from: number, count: number): number | undefined {
  const moves: { readonly [key: string]: number } = {
    ArrowRight: from + 1,
    ArrowDown: from + 1,
    ArrowLeft: from - 1,
    ArrowUp: from - 1,
    Home: 0,
    End: count - 1,
  };
  const to = moves[key];
  return to === undefined ? undefined : Math.min(count - 1, Math.max(0, to));
}

/** Focus the thumbnail the arrow keys, Home, End or Tab ask for; Escape and `O` close the grid. Keys the grid takes do not reach the deck behind it. */
function onGridKey(e: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    return;
  }
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  if (buttons.length === 0) return;
  const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
  // Tab goes round the thumbnails, so focus stays in the dialog
  const to = e.key === 'Tab' ? (from + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length : target(e.key, from, buttons.length);
  if (to === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  buttons[to]?.focus();
}

/** The grid is a modal: focus goes to the current screen's thumbnail on open and back to where it was on close. */
function useFocusKept(grid: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const before = document.activeElement;
    const buttons = grid.current?.querySelectorAll<HTMLButtonElement>('button');
    const here = grid.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]') ?? buttons?.[0];
    here?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [grid]);
}

/**
 * The overview grid over the deck.
 *
 * @public
 */
export function DeckOverview(props: DeckOverviewProps): ReactNode {
  const { store, registries, assets, screens, current, onPick, onClose } = props;
  const grid = useRef<HTMLDivElement>(null);
  useFocusKept(grid);
  const names = useValue(useMemo(() => store.query((view) => screens.map((id) => (view.get(id) as { name?: unknown } | undefined)?.name)), [store, screens]));
  return (
    // the grid takes the clicks that land on it, so the deck behind does not step forward
    <div
      ref={grid}
      role="dialog"
      aria-modal="true"
      aria-label="Screen overview"
      data-testid="deck-overview"
      onKeyDown={(e) => onGridKey(e, onClose)}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        padding: 24,
        background: 'rgba(0, 0, 0, 0.88)',
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, ${THUMB.w + 8}px)`,
        gridAutoRows: THUMB.h + 8,
        gap: 16,
        justifyContent: 'center',
        alignContent: 'start',
      }}
    >
      {screens.map((id, i) => {
        const name = typeof names[i] === 'string' ? `: ${names[i]}` : '';
        const here = id === current;
        return (
          <button
            key={id}
            type="button"
            aria-label={`Screen ${i + 1}${name}`}
            aria-current={here ? 'true' : undefined}
            data-screen-id={id}
            onClick={() => onPick(id)}
            style={{
              padding: 0,
              border: `4px solid ${here ? '#4c8dff' : 'transparent'}`,
              background: 'none',
              cursor: 'pointer',
              width: THUMB.w + 8,
              height: THUMB.h + 8,
            }}
          >
            <span aria-hidden="true" inert style={{ display: 'block', width: THUMB.w, height: THUMB.h, overflow: 'hidden', pointerEvents: 'none' }}>
              <ScreenBoundary>
                <ScreenView
                  store={store}
                  screenId={id}
                  mode="present"
                  view={{ kind: 'fit', box: THUMB }}
                  registries={registries}
                  {...(assets === undefined ? {} : { assets })}
                />
              </ScreenBoundary>
            </span>
          </button>
        );
      })}
    </div>
  );
}
