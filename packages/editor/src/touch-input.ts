// The canvas's fingers (FR-EDT-019): a consumer in front of the canvas's own that keeps the touch
// pointers down. One finger passes through to the tools; a second ends what the first began (the
// tools cancel) and the two pan and zoom the page (pinchCamera) until they lift; a finger held still
// for TOUCH.longPressMs asks for the context menu, and what it does next is no tool's. Mouse and pen
// input passes straight through. The timer is injected, so this is tested without a clock.
import type { Vec2 } from '@fluxion/geometry';
import type { Camera } from './camera.js';
import type { PointerInfo } from './pointer.js';
import type { PointerConsumer } from './pointer-input.js';
import type { Session } from './session.js';
import type { ToolDispatcher } from './tools.js';
import { moved, pinchCamera, TOUCH } from './touch.js';

/**
 * Runs `fn` after `ms`; the returned function cancels it.
 *
 * @public
 */
export type Timer = (ms: number, fn: () => void) => () => void;

/**
 * What the fingers need besides the canvas's own consumer.
 *
 * @public
 */
export type TouchDeps = {
  /** The session whose camera two fingers move. */
  readonly session: Session;
  /** The tools, cancelled when a second finger lands or a press is held. */
  readonly tools: ToolDispatcher | undefined;
  /** The long-press timer. */
  readonly timer: Timer;
  /** A finger held still: the context menu is asked for at its press. */
  onLongPress(at: PointerInfo): void;
};

/** A finger down: where it landed and where it is, canvas px. */
type Finger = { readonly start: Vec2; at: Vec2 };

/** Two fingers pinching: the camera and their places when the second landed. */
type Pinch = { readonly camera: Camera; readonly ids: readonly [number, number]; readonly from: readonly [Vec2, Vec2] };

/** The fingers on the canvas, and what they are doing. */
class Fingers {
  readonly #fingers = new Map<number, Finger>();
  #pinch: Pinch | undefined;
  #stopTimer: (() => void) | undefined;
  /** Every finger's input goes to no tool until all have lifted (after a pinch or a long press). */
  #swallow = false;

  readonly inner: PointerConsumer;
  readonly deps: TouchDeps;

  constructor(inner: PointerConsumer, deps: TouchDeps) {
    this.inner = inner;
    this.deps = deps;
  }

  #stop(): void {
    this.#stopTimer?.();
    this.#stopTimer = undefined;
  }

  #down(i: PointerInfo): boolean | undefined {
    this.#fingers.set(i.pointerId, { start: i.screen, at: i.screen });
    if (this.#fingers.size === 1 && !this.#swallow) {
      this.#stopTimer = this.deps.timer(TOUCH.longPressMs, () => {
        this.#stopTimer = undefined;
        this.#swallow = true;
        this.deps.tools?.cancel();
        this.deps.onLongPress(i);
      });
      return this.inner.deliver(i);
    }
    this.#stop();
    // a pinch's two fingers are both down while it lasts, so the second finger always starts one
    if (this.#fingers.size === 2) {
      this.deps.tools?.cancel();
      const [a, b] = [...this.#fingers.entries()] as [[number, Finger], [number, Finger]];
      this.#pinch = { camera: this.deps.session.camera.get(), ids: [a[0], b[0]], from: [a[1].at, b[1].at] };
    }
    this.#swallow = true;
    // taken: the browser's own gestures do not act on the canvas
    return true;
  }

  #move(i: PointerInfo): boolean | undefined {
    const f = this.#fingers.get(i.pointerId);
    if (f === undefined) return undefined;
    f.at = i.screen;
    const p = this.#pinch;
    if (p !== undefined) {
      const [a, b] = p.ids.map((id) => (this.#fingers.get(id) as Finger).at) as [Vec2, Vec2];
      this.deps.session.camera.set(pinchCamera(p.camera, p.from, [a, b]));
      return undefined;
    }
    if (moved(f.start, f.at)) this.#stop();
    return this.#swallow ? undefined : this.inner.deliver(i);
  }

  #lift(i: PointerInfo): boolean | undefined {
    if (!this.#fingers.delete(i.pointerId)) return undefined;
    this.#stop();
    // a pinch ends when either finger lifts: the other moves nothing until it lifts too
    if (this.#pinch?.ids.includes(i.pointerId)) this.#pinch = undefined;
    const swallowed = this.#swallow;
    if (this.#fingers.size === 0) this.#swallow = false;
    return swallowed ? undefined : this.inner.deliver(i);
  }

  deliver(i: PointerInfo): boolean | undefined {
    if (i.pointerType !== 'touch') return this.inner.deliver(i);
    if (i.phase === 'down') return this.#down(i);
    return i.phase === 'move' ? this.#move(i) : this.#lift(i);
  }
}

/**
 * The canvas consumer `inner` with fingers in front of it: one finger passes through, two pan and
 * zoom, a held one asks for the context menu.
 *
 * @public
 */
export function touchConsumer(inner: PointerConsumer, deps: TouchDeps): PointerConsumer {
  const fingers = new Fingers(inner, deps);
  return { deliver: (i) => fingers.deliver(i), frameEnd: () => inner.frameEnd?.() };
}
