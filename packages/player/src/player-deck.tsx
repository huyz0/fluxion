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
import { type ChromeLabels, DeckChrome } from './deck-chrome.js';
import { type DeckAction, deckAction, NumberEntry } from './deck-input.js';
import { bindLinks } from './deck-links.js';
import { DeckOverview } from './deck-overview.js';
import { toggleFullscreen } from './fullscreen.js';
import { PresentationController } from './presentation-controller.js';
import { ScreenBoundary } from './screen-boundary.js';
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
  /** Keep the position in the page's URL hash, so a reload or a shared link opens there and back moves between screens (default false: an embedding page keeps its own URL). */
  readonly links?: boolean;
  /** Draw the chrome over the screen: progress bar, screen counter and a controls bar that hides when idle (default false). */
  readonly chrome?: boolean;
  /** The names of the chrome's controls in the page's language (English by default). */
  readonly labels?: Partial<ChromeLabels>;
  /** `viewport` (default) fills the window; `container` fills the nearest positioned ancestor, as inside the `<fluxion-player>` element. */
  readonly layout?: 'viewport' | 'container';
  /** Whose keys move the deck: `window` (default: a deck that is the page) or `stage` (the deck's own, when it has focus: an embedded deck must not take the page's keys). */
  readonly scope?: 'window' | 'stage';
  /** Called with the controller that moves this deck, once it exists (and again if the document changes under it), so a host can drive it and follow its position. */
  readonly onController?: (controller: PresentationController) => void;
};

/** Whether `target` is something that takes the keys itself: a link, a button, a field (the focusable stage of an embedded deck is not). */
const interactive = (target: EventTarget | null): boolean => {
  const hit =
    target instanceof Element
      ? target.closest('a, button, input, textarea, select, summary, [contenteditable], [tabindex]:not([tabindex="-1"]), [part~="chrome"]')
      : null;
  return hit !== null && !hit.hasAttribute('data-fx-stage');
};

/** Whether `target` is in the deck's own chrome, whose buttons take only the keys that press them. */
const inChrome = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[part~="chrome"]') !== null;

/**
 * Whether a key is not the deck's: one with a modifier, a repeat, one another handler took, or one aimed at a link, button or field. A button of the deck's own chrome
 * keeps Enter and Space (they press it) and lets the other keys through to the deck.
 */
const leftAlone = (e: KeyboardEvent): boolean =>
  e.ctrlKey ||
  e.metaKey ||
  e.altKey ||
  e.repeat ||
  e.defaultPrevented ||
  (interactive(e.target) && !(inChrome(e.target) && e.key !== 'Enter' && e.key !== ' '));

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
  options: { readonly links: boolean; readonly scope: 'window' | 'stage'; readonly onController: ((controller: PresentationController) => void) | undefined },
): { controller: PresentationController; screens: readonly RecordId[]; overview: OverviewSwitch } {
  const { links, scope, onController } = options;
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
  useEffect(() => onController?.(controller), [controller, onController]);
  // the position is in the URL: a reload or a shared link opens there, back and forward move
  useEffect(() => (links ? bindLinks(controller, window) : undefined), [controller, links]);
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
    const target: EventTarget | null = scope === 'stage' ? stage.current : window;
    target?.addEventListener('keydown', onKey as EventListener);
    return () => {
      clearTimeout(timer);
      target?.removeEventListener('keydown', onKey as EventListener);
    };
  }, [controller, entry, overview, store, stage, scope]);
  return { controller, screens, overview };
}

/** What the chrome acts on. */
type ChromeDeck = {
  readonly controller: PresentationController;
  readonly overview: OverviewSwitch;
  readonly stage: RefObject<HTMLElement | null>;
  readonly index: number;
  readonly count: number;
};

/** The chrome over a deck: its buttons are the deck's own moves, the overview and full screen. */
function ChromeOf(props: { readonly deck: ChromeDeck; readonly labels: Partial<ChromeLabels> | undefined }): ReactNode {
  const { controller, overview, stage, index, count } = props.deck;
  return (
    <DeckChrome
      index={index}
      count={count}
      {...(props.labels === undefined ? {} : { labels: props.labels })}
      onPrevious={() => void controller.prev()}
      onNext={() => void controller.next()}
      onOverview={overview.toggle}
      onFullscreen={() => stage.current !== null && void toggleFullscreen(stage.current, document)}
    />
  );
}

/** The screen on show, fitted into `box`; nothing before there is a screen or a box. A screen that cannot be drawn is drawn as nothing, and the next one is still reachable. */
function ShownScreen(props: {
  readonly store: Store;
  readonly registries: RenderRegistries;
  readonly assets: AssetUrls | undefined;
  readonly screen: RecordId | undefined;
  readonly box: { readonly w: number; readonly h: number };
  readonly hidden: ReadonlySet<RecordId> | undefined;
}): ReactNode {
  const { store, registries, assets, screen, box, hidden } = props;
  if (screen === undefined || box.w === 0) return null;
  return (
    <ScreenBoundary key={screen}>
      <ScreenView
        store={store}
        screenId={screen}
        mode="present"
        view={{ kind: 'fit', box }}
        registries={registries}
        {...(assets === undefined ? {} : { assets })}
        {...(hidden === undefined ? {} : { hidden })}
      />
    </ScreenBoundary>
  );
}

/** The options of a deck with their defaults. */
function withDefaults(props: PlayerDeckProps): {
  background: string;
  links: boolean;
  chrome: boolean;
  layout: 'viewport' | 'container';
  scope: 'window' | 'stage';
} {
  return {
    background: props.background ?? '#000',
    links: props.links ?? false,
    chrome: props.chrome ?? false,
    layout: props.layout ?? 'viewport',
    scope: props.scope ?? 'window',
  };
}

/**
 * The document presented screen by screen: the visible screens in presentation order, the first one first, moved with the keyboard or a click, a screen's
 * build groups played before the next screen.
 *
 * @public
 */
export function PlayerDeck(props: PlayerDeckProps): ReactNode {
  const { store, registries, assets, labels, onController } = props;
  const { background, links, chrome, layout, scope } = withDefaults(props);
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const { controller, screens, overview } = useDeck(store, ref, { links, scope, onController });
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
      data-fx-stage=""
      role="application"
      aria-label="Presentation"
      data-screen-index={index}
      data-group={group}
      onClick={onClick}
      tabIndex={scope === 'stage' ? 0 : undefined}
      style={{ position: layout === 'container' ? 'absolute' : 'fixed', inset: 0, background }}
    >
      <ShownScreen store={store} registries={registries} assets={assets} screen={shown} box={box} hidden={hidden} />
      {chrome ? <ChromeOf deck={{ controller, overview, stage: ref, index, count: screens.length }} labels={labels} /> : null}
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
