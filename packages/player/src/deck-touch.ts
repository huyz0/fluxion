// Touch on the deck (FR-RSP-001): a swipe left or right moves a screen, a pinch zooms into the screen, a drag pans it, and a double tap puts it back to fit. A tap steps
// forward through the click the browser makes of it. This file only recognises: fingers go in as pointer positions, effects come out, and the clock and the size of the
// stage are given, so it needs no DOM. While the screen is zoomed a swipe pans instead of moving, and a tap does not step.

/** The zoom and offset of the screen in the stage: `x` and `y` are px of translation (zero or less) of a screen scaled by `zoom` from its top left corner. */
export type TouchView = { readonly zoom: number; readonly x: number; readonly y: number };

/** What a gesture asks for. */
export type TouchEffect = { readonly kind: 'next' } | { readonly kind: 'prev' } | { readonly kind: 'view'; readonly view: TouchView };

/** The screen as it fits. */
export const FIT: TouchView = { zoom: 1, x: 0, y: 0 };
/** The most the screen is zoomed. */
export const MAX_ZOOM = 4;
/** The least distance (px) of a swipe, and how much further across than up or down it must go. */
const SWIPE_PX = 50;
const SWIPE_RATIO = 1.5;
/** The longest a swipe takes (ms). */
const SWIPE_MS = 800;
/** A touch that moves less than this (px) and ends within TAP_MS is a tap; two taps within DOUBLE_MS and DOUBLE_PX are a double tap. */
const TAP_PX = 10;
const TAP_MS = 300;
const DOUBLE_MS = 350;
const DOUBLE_PX = 40;

type Finger = { x0: number; y0: number; x: number; y: number; t0: number };
type Pinch = { dist: number; zoom: number; cx: number; cy: number; view: TouchView };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const distance = (a: Finger, b: Finger): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A view with `zoom` (kept within 1 and {@link MAX_ZOOM}) and the offset `x`, `y` kept so the screen always covers the stage `size`.
 *
 * @public
 */
export function boundedView(view: TouchView, size: { readonly w: number; readonly h: number }): TouchView {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  return { zoom, x: clamp(view.x, size.w * (1 - zoom), 0), y: clamp(view.y, size.h * (1 - zoom), 0) };
}

/** The move a finger's stroke asks for when it ended at `t`: quick, long enough, and mostly across. */
function swipeOf(f: Finger, t: number): TouchEffect | undefined {
  const dx = f.x - f.x0;
  const dy = f.y - f.y0;
  const swipe = Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= SWIPE_RATIO * Math.abs(dy) && t - f.t0 <= SWIPE_MS;
  return swipe ? { kind: dx < 0 ? 'next' : 'prev' } : undefined;
}

/** Recognises the gestures of fingers on a stage. */
export class TouchGestures {
  readonly #fingers = new Map<number, Finger>();
  readonly #size: () => { readonly w: number; readonly h: number };
  readonly #now: () => number;
  #view: TouchView = FIT;
  #pinch: Pinch | undefined;
  /** The last tap: where and when, to tell a double tap. */
  #tap: { x: number; y: number; t: number } | undefined;
  /** Whether the touch in progress went further than a tap or turned into a pinch (it is then no swipe or tap). */
  #travelled = false;
  /** Whether the touch in progress was a pinch at any moment: lifting its last finger is no swipe and no tap. */
  #pinched = false;

  constructor(size: () => { readonly w: number; readonly h: number }, now: () => number) {
    this.#size = size;
    this.#now = now;
  }

  /** The view now. */
  get view(): TouchView {
    return this.#view;
  }

  /** Put the screen back to fit (a new screen, or a stage of another size). */
  reset(): TouchView {
    this.#view = FIT;
    this.#pinch = undefined;
    return FIT;
  }

  down(id: number, x: number, y: number): void {
    this.#fingers.set(id, { x0: x, y0: y, x, y, t0: this.#now() });
    if (this.#fingers.size === 1) {
      this.#travelled = false;
      this.#pinched = false;
    }
    if (this.#fingers.size === 2) this.#startPinch();
  }

  move(id: number, x: number, y: number): TouchEffect | undefined {
    const f = this.#fingers.get(id);
    if (f === undefined) return undefined;
    const dx = x - f.x;
    const dy = y - f.y;
    f.x = x;
    f.y = y;
    if (Math.hypot(f.x - f.x0, f.y - f.y0) > TAP_PX) this.#travelled = true;
    if (this.#pinch !== undefined) return this.#pinchTo();
    // a drag of a zoomed screen pans it; at fit, the swipe is judged when the finger lifts
    if (this.#view.zoom > 1 && this.#fingers.size === 1) return this.#set({ ...this.#view, x: this.#view.x + dx, y: this.#view.y + dy });
    return undefined;
  }

  up(id: number): TouchEffect | undefined {
    const f = this.#fingers.get(id);
    this.#fingers.delete(id);
    if (f === undefined) return undefined;
    if (this.#pinch !== undefined) {
      // one finger left of a pinch goes on as a pan; none left ends it
      this.#pinch = undefined;
      this.#travelled = true;
      return undefined;
    }
    return this.#fingers.size === 0 ? this.#lifted(f) : undefined;
  }

  cancel(id: number): void {
    this.#fingers.delete(id);
    if (this.#fingers.size < 2) this.#pinch = undefined;
    this.#travelled = true;
  }

  /** The only finger lifted: a tap (a double tap fits a zoomed screen) or a swipe (at fit, it moves). */
  #lifted(f: Finger): TouchEffect | undefined {
    const t = this.#now();
    if (this.#pinched) return undefined;
    if (!this.#travelled && t - f.t0 <= TAP_MS) return this.#tapped(f, t);
    return this.#view.zoom > 1 ? undefined : swipeOf(f, t);
  }

  #tapped(f: Finger, t: number): TouchEffect | undefined {
    const last = this.#tap;
    const double = last !== undefined && t - last.t <= DOUBLE_MS && Math.hypot(f.x - last.x, f.y - last.y) <= DOUBLE_PX;
    this.#tap = double ? undefined : { x: f.x, y: f.y, t };
    return double && this.#view.zoom > 1 ? this.#set(FIT) : undefined;
  }

  #startPinch(): void {
    const [a, b] = [...this.#fingers.values()] as [Finger, Finger];
    this.#travelled = true;
    this.#pinched = true;
    this.#pinch = { dist: Math.max(1, distance(a, b)), zoom: this.#view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: this.#view };
  }

  /** The zoom follows the spread of the two fingers, and the point of the screen that was between them stays between them. */
  #pinchTo(): TouchEffect | undefined {
    const pinch = this.#pinch;
    const [a, b] = [...this.#fingers.values()];
    if (pinch === undefined || a === undefined || b === undefined) return undefined;
    const zoom = clamp(pinch.zoom * (distance(a, b) / pinch.dist), 1, MAX_ZOOM);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    // the screen point under the first centre, in screen coordinates, stays under the centre now
    const px = (pinch.cx - pinch.view.x) / pinch.view.zoom;
    const py = (pinch.cy - pinch.view.y) / pinch.view.zoom;
    return this.#set({ zoom, x: cx - px * zoom, y: cy - py * zoom });
  }

  #set(view: TouchView): TouchEffect {
    this.#view = boundedView(view, this.#size());
    return { kind: 'view', view: this.#view };
  }
}
