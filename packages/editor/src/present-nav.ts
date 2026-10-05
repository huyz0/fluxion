// Moving through the presentation in place (FR-PRS-002, M11.34): the keys of the player's deck move a PresentationController over the presentation
// order and each screen's build groups, and the screen the controller arrives on is the session's shown screen, so leaving present mode (Esc) lands
// on the screen last shown. The elements a build group hides are returned for the view to leave out.
import type { Store } from '@fluxion/core';
import { buildsOfScreen, type DeckAction, deckAction, hiddenAt, NumberEntry, PresentationController, realtimeClock } from '@fluxion/player';
import { presentationOrder, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { useEffect, useMemo, useReducer } from 'react';
import { switchScreen } from './screen-switch.js';
import type { Session } from './session.js';

/** How long a typed screen number waits for Enter before it is dropped. */
const TYPING_MS = 2000;

/** What the screen-number edits and the moves of the deck's keys do; full screen and the overview are the deck's own. */
type Parts = { readonly controller: PresentationController; readonly entry: NumberEntry; readonly screens: () => readonly RecordId[] };

/** Go to the screen whose number was typed, when there is one. */
function goToTyped({ controller, entry, screens }: Parts): void {
  const number = entry.take();
  const screen = number === undefined ? undefined : screens()[number - 1];
  if (screen !== undefined) controller.goTo(screen);
}

/** What each action of the deck's keys does here; an action that is not in it is not the presentation's. */
const RUN: { readonly [kind: string]: (parts: Parts, action: DeckAction) => void } = {
  next: ({ controller }) => void controller.next(),
  prev: ({ controller }) => void controller.prev(),
  first: ({ controller }) => void controller.first(),
  last: ({ controller }) => void controller.last(),
  digit: ({ entry }, action) => entry.push((action as { digit: string }).digit),
  erase: ({ entry }) => entry.erase(),
  cancel: ({ entry }) => entry.clear(),
  commit: goToTyped,
};

/** Whether a key is not for the presentation: one with a modifier, a repeat, or one aimed at a link, button or field. */
const leftAlone = (e: KeyboardEvent): boolean =>
  e.ctrlKey ||
  e.metaKey ||
  e.altKey ||
  e.repeat ||
  (e.target instanceof Element && e.target.closest('a, button, input, textarea, select, summary, [contenteditable]') !== null);

/** Act on a key: a move, or a digit, Enter or Backspace of the screen number being typed. Returns whether the key was the presentation's. */
function onKey(e: KeyboardEvent, parts: Parts): boolean {
  const action = leftAlone(e) ? undefined : deckAction(e.key, parts.entry.typing);
  const run = action === undefined ? undefined : RUN[action.kind];
  if (action === undefined || run === undefined) return false;
  run(parts, action);
  return true;
}

/**
 * The presentation in place: keys move through the visible screens and their build groups, the session's shown screen follows, and the elements the
 * current group hides are returned (none when the screen shown is not the one the controller is on, a hidden screen presented with shift+F5).
 *
 * @public
 */
export function usePresentNav(store: Store, session: Session): ReadonlySet<RecordId> | undefined {
  const screens = useMemo(() => store.query((view) => presentationOrder(view, false)), [store]);
  const controller = useMemo(() => {
    const c = new PresentationController({ screens, groups: (screen) => store.query((view) => buildsOfScreen(view, screen).clicks)() }, realtimeClock);
    const here = session.screen.get();
    if (here !== undefined && screens().includes(here)) c.goTo(here);
    return c;
  }, [store, session, screens]);
  const [, moved] = useReducer((n: number) => n + 1, 0);
  const entry = useMemo(() => new NumberEntry(), []);
  useEffect(
    () =>
      controller.subscribe((position) => {
        if (position !== undefined && position.screen !== session.screen.get()) switchScreen(session, position.screen);
        moved();
      }),
    [controller, session],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (e: KeyboardEvent) => {
      if (onKey(e, { controller, entry, screens })) e.preventDefault();
      clearTimeout(timer);
      if (entry.typing) timer = setTimeout(() => entry.clear(), TYPING_MS);
    };
    window.addEventListener('keydown', listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', listener);
    };
  }, [controller, entry, screens]);
  const position = controller.position();
  const shown = session.screen.get();
  // read through the store's signal, so a step changed under the presentation (undo, a collaborator) redraws it
  const hidden = useMemo(
    () => store.query((view) => (position === undefined || position.screen !== shown ? undefined : hiddenAt(view, position.screen, position.group))),
    [store, position?.screen, position?.group, shown],
  );
  return useValue(hidden);
}
