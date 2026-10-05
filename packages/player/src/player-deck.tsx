// The one-file player's deck (FR-FIL-002, FR-EXP-001, FR-PRS-002): the document's visible screens, one at a time, fitted into the window and drawn by the
// same <ScreenView> as the editor (FR-EDT-010). It is driven by a PresentationController over the presentation order and each screen's build groups: the arrow,
// page, space, enter and backspace keys, Home and End, a click, and a typed screen number plus Enter move it; F is full screen and O opens the overview grid of screens (deck-overview.tsx). The deck draws no text of its own
// (ADR-0023). Keys are left to a focused link, button or field, to a key another handler took, and to key repeat.
import type { Store } from '@fluxion/core';
import { type AssetUrls, presentationOrder, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type MouseEvent, type ReactNode, type RefObject, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { realtimeClock } from './clock.js';
import { buildsOfScreen, hiddenAt } from './deck-builds.js';
import { type DeckAction, deckAction, NumberEntry } from './deck-input.js';
import { DeckOverview } from './deck-overview.js';
import { toggleFullscreen } from './fullscreen.js';
import { PresentationController } from './presentation-controller.js';
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
  /** The colour of the bars a screen of another shape leaves around it (a CSS colour; default black). */
  readonly background?: string;
};

/** Whether `target` is something that takes the keys itself: a link, a button, a field. */
const interactive = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('a, button, input, textarea, select, summary, [contenteditable], [tabindex]:not([tabindex="-1"])') !== null;

/** Whether a key is not the deck's: one with a modifier, a repeat, one another handler took, or one aimed at a link, button or field. */
const leftAlone = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented || interactive(e.target);

/** The overview grid being open or not. */
type OverviewSwitch = {
  /** Whether the grid is open now. */
  readonly open: boolean;
  /** Open it when closed, close it when open. */
  readonly toggle: () => void;
  /** Close it. */
  readonly close: () => void;
};

/** What the keys act on. */
type DeckParts = {
  readonly controller: PresentationController;
  readonly entry: NumberEntry;
  readonly stage: HTMLElement | null;
  readonly overview: OverviewSwitch;
  /** The screens in presentation order now. */
  readonly screens: () => readonly RecordId[];
};

/** Go to the screen whose number was typed, when there is one. */
function goToTyped({ controller, entry, screens }: DeckParts): void {
  const number = entry.take();
  const screen = number === undefined ? undefined : screens()[number - 1];
  if (screen !== undefined) controller.goTo(screen);
}

/** What each action does; a digit, a commit and an erase are the number being typed. */
const RUN: { readonly [kind in DeckAction['kind']]: (parts: DeckParts, action: DeckAction) => void } = {
  next: ({ controller }) => void controller.next(),
  prev: ({ controller }) => void controller.prev(),
  first: ({ controller }) => void controller.first(),
  last: ({ controller }) => void controller.last(),
  fullscreen: ({ stage }) => void (stage !== null && toggleFullscreen(stage, document)),
  overview: ({ overview, entry }) => {
    // a number half typed is dropped, not left to surprise the deck when the grid closes
    entry.clear();
    overview.toggle();
  },
  digit: ({ entry }, action) => entry.push((action as { digit: string }).digit),
  erase: ({ entry }) => entry.erase(),
  cancel: ({ entry }) => entry.clear(),
  commit: goToTyped,
};

/** Act on a key aimed at the window: the move, the full screen or the typing it asks for, or nothing; a handled key is not left to the page. */
function handleKey(e: KeyboardEvent, parts: DeckParts): void {
  const action = leftAlone(e) ? undefined : deckAction(e.key, parts.entry.typing);
  // an open grid takes the keys itself (its own handler, and Escape or O when focus is outside it); the deck behind it stays where it is
  if (parts.overview.open) {
    if (action?.kind === 'overview' || (e.key === 'Escape' && !leftAlone(e))) {
      e.preventDefault();
      parts.overview.close();
    }
    return;
  }
  if (action === undefined) return;
  e.preventDefault();
  RUN[action.kind](parts, action);
}

/** How long a typed screen number waits for Enter before it is dropped. */
const TYPING_MS = 2000;

/** The controller over `store`'s presentation order and builds, the screen number being typed, and the keys that drive them; the component re-renders on every move. */
function useDeck(
  store: Store,
  stage: RefObject<HTMLElement | null>,
): { controller: PresentationController; screens: readonly RecordId[]; overview: OverviewSwitch } {
  // a document that changes under the deck re-renders it; the controller reads the screens afresh on every move
  const screens = useValue(useMemo(() => store.query((view) => presentationOrder(view, false)), [store]));
  const controller = useMemo(
    () =>
      new PresentationController(
        {
          screens: () => store.query((view) => presentationOrder(view, false))(),
          groups: (screen) => store.query((view) => buildsOfScreen(view, screen).clicks)(),
        },
        realtimeClock,
      ),
    [store],
  );
  const [, moved] = useReducer((n: number) => n + 1, 0);
  const entry = useMemo(() => new NumberEntry(), []);
  const [open, setOpen] = useState(false);
  const overview = useMemo<OverviewSwitch>(() => ({ open, toggle: () => setOpen((was) => !was), close: () => setOpen(false) }), [open]);
  useEffect(() => controller.subscribe(moved), [controller]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const parts = (): DeckParts => ({
      controller,
      entry,
      overview,
      stage: stage.current,
      screens: () => store.query((view) => presentationOrder(view, false))(),
    });
    const onKey = (e: KeyboardEvent) => {
      handleKey(e, parts());
      // a number waits for Enter for a while and is then dropped
      clearTimeout(timer);
      if (entry.typing) timer = setTimeout(() => entry.clear(), TYPING_MS);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [controller, entry, overview, store, stage]);
  return { controller, screens, overview };
}

/**
 * The document presented screen by screen: the visible screens in presentation order, the first one first, moved with the keyboard or a click, a screen's
 * build groups played before the next screen.
 *
 * @public
 */
export function PlayerDeck(props: PlayerDeckProps): ReactNode {
  const { store, registries, assets, background = '#000' } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const { controller, screens, overview } = useDeck(store, ref);
  const position = controller.position();
  const shown = position?.screen;
  const group = position?.group ?? 0;
  // read through the store's signal, so a step changed under the presentation redraws it
  const hidden = useValue(useMemo(() => store.query((view) => (shown === undefined ? undefined : hiddenAt(view, shown, group))), [store, shown, group]));
  // a click on the stage (not on a link or a button) is a step forward
  const onClick = (e: MouseEvent) => {
    if (e.button === 0 && !e.defaultPrevented && !interactive(e.target)) controller.next();
  };
  const index = shown === undefined ? 0 : Math.max(0, screens.indexOf(shown));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are handled on the window, where a presenter's clicker sends them
    <div
      ref={ref}
      className="fx-player"
      data-testid="player-deck"
      role="application"
      aria-label="Presentation"
      data-screen-index={index}
      data-group={group}
      onClick={onClick}
      style={{ position: 'fixed', inset: 0, background }}
    >
      {shown === undefined || box.w === 0 ? null : (
        <ScreenView
          store={store}
          screenId={shown}
          mode="present"
          view={{ kind: 'fit', box }}
          registries={registries}
          {...(assets === undefined ? {} : { assets })}
          {...(hidden === undefined ? {} : { hidden })}
        />
      )}
      {overview.open ? (
        <DeckOverview
          store={store}
          registries={registries}
          {...(assets === undefined ? {} : { assets })}
          screens={screens}
          current={shown}
          onPick={(screen) => {
            controller.goTo(screen);
            overview.close();
          }}
          onClose={overview.close}
        />
      ) : null}
    </div>
  );
}
