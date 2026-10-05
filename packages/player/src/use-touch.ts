// The touch gestures of a deck (FR-RSP-001): fingers on the stage go through `TouchGestures`, a swipe moves the controller, and the view (zoom and pan) it keeps is
// returned for the deck to apply. The view goes back to fit when the screen or the stage's size changes (an orientation change keeps the screen and build group).
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { FIT, type TouchEffect, TouchGestures, type TouchView } from './deck-touch.js';
import type { PresentationController } from './presentation-controller.js';
import type { Box } from './use-box.js';

/** What the touch handling needs of its deck. */
type TouchDeck = {
  readonly controller: PresentationController;
  /** The screen on show: a new one starts at fit. */
  readonly screen: string | undefined;
  readonly box: Box;
  /** Whether a target takes touches itself (a link, a button, the chrome). */
  readonly ignore: (target: EventTarget | null) => boolean;
  /** Whether the deck is not to be moved (the overview is open). */
  readonly blocked: boolean;
};

/** How long after a touch on a zoomed screen a click is not a step (ms). */
const QUIET_MS = 600;

/** What each effect does: a move of the controller or a new view. */
const EFFECT: {
  readonly [kind in TouchEffect['kind']]: (effect: TouchEffect, controller: PresentationController, setView: (view: TouchView) => void) => void;
} = {
  next: (_effect, controller) => void controller.next(),
  prev: (_effect, controller) => void controller.prev(),
  view: (effect, _controller, setView) => setView((effect as { view: TouchView }).view),
};

/** Keep the finger's events coming to the stage; a pointer that is not live (a synthetic event) cannot be captured, which does no harm. */
function capture(stage: HTMLElement, id: number): void {
  try {
    stage.setPointerCapture(id);
  } catch {
    // nothing to capture
  }
}

/** The zoom and pan of the deck's screen, moved by the fingers on `stage`. */
export function useTouch(stage: RefObject<HTMLElement | null>, deck: TouchDeck): TouchView & { readonly clickable: () => boolean } {
  const { controller, screen, box, ignore, blocked } = deck;
  const [view, setView] = useState<TouchView>(FIT);
  // the click a browser makes of the last tap of a zoomed screen comes after the view has changed: it is not a step forward
  const quietUntil = useRef(0);
  const gestures = useMemo(
    () =>
      new TouchGestures(
        () => ({ w: box.w, h: box.h }),
        () => performance.now(),
      ),
    [box.w, box.h],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new screen or a new size starts at fit
  useEffect(() => setView(gestures.reset()), [gestures, screen]);
  useEffect(() => {
    const el = stage.current;
    if (el === null || blocked) return;
    const touch = (e: PointerEvent) => e.pointerType === 'touch' && !ignore(e.target);
    const apply = (effect: TouchEffect | undefined) => {
      if (effect !== undefined) EFFECT[effect.kind](effect, controller, setView);
    };
    const down = (e: PointerEvent) => {
      if (!touch(e)) return;
      capture(el, e.pointerId);
      gestures.down(e.pointerId, e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => touch(e) && apply(gestures.move(e.pointerId, e.clientX, e.clientY));
    const up = (e: PointerEvent) => {
      if (!touch(e)) return;
      if (gestures.view.zoom > 1) quietUntil.current = performance.now() + QUIET_MS;
      apply(gestures.up(e.pointerId));
    };
    const cancel = (e: PointerEvent) => gestures.cancel(e.pointerId);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [stage, controller, gestures, ignore, blocked]);
  return { ...view, clickable: () => performance.now() >= quietUntil.current };
}
