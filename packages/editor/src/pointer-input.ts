// The DOM side of the pointer pipeline (ADR-0028): one listener per pointer event type on the canvas
// element, the browser's coalesced moves unpacked, frames on requestAnimationFrame. What happens to
// the events is the consumer's: tools (M6.11), and until then the canvas pan.
import { type RefObject, useEffect, useRef } from 'react';
import type { Camera } from './camera.js';
import { createPointerPipeline, type FrameScheduler, type PointerInfo, type PointerPhase, type PointerPipeline, pointerInfo } from './pointer.js';

/**
 * What consumes the pipeline.
 *
 * @public
 */
export type PointerConsumer = {
  /** One event; for a down, returning true takes it (the browser's own default, such as a middle-click autoscroll, is prevented). */
  deliver(info: PointerInfo): boolean | undefined;
  /** After each flush of the moves: each frame, and before a down, up or cancel (a gesture commits here). */
  frameEnd?(): void;
};

/** Frames on requestAnimationFrame. */
const animationFrames: FrameScheduler = (callback) => {
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
};

const PHASES: readonly (readonly [string, PointerPhase])[] = [
  ['pointerdown', 'down'],
  ['pointermove', 'move'],
  ['pointerup', 'up'],
  ['pointercancel', 'cancel'],
];

/** The events a move stands for: the browser's coalesced ones when it has them, else itself. */
const unpack = (e: PointerEvent): readonly PointerEvent[] => {
  const all = e.getCoalescedEvents?.() ?? [];
  return all.length > 0 ? all : [e];
};

/** Where DOM events go: the pipeline, for the canvas element, through the current camera. */
type Feed = { readonly pipe: PointerPipeline; readonly el: HTMLElement; readonly camera: () => Camera };

/** One DOM event into the pipeline: a move as the moves it stands for; a down captures the pointer. */
function feed(to: Feed, phase: PointerPhase, e: PointerEvent): void {
  const { pipe, el } = to;
  const camera = to.camera();
  const r = el.getBoundingClientRect();
  const origin = { x: r.left, y: r.top };
  if (phase === 'move') {
    for (const sub of unpack(e)) pipe.push(pointerInfo('move', sub, origin, camera));
    return;
  }
  // a pointer the browser no longer tracks (it lifted already, or was synthesized) cannot be captured
  if (phase === 'down') {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // not captured: its moves still reach the canvas while over it
    }
  }
  if (pipe.push(pointerInfo(phase, e, origin, camera)) === true) e.preventDefault();
}

/**
 * Feed the pointer events of `ref`'s element, through `camera()`, to `consumer`: downs, ups and
 * cancels at once, moves once per frame.
 *
 * @public
 */
export function usePointerInput(ref: RefObject<HTMLElement | null>, camera: () => Camera, consumer: PointerConsumer): void {
  // the latest consumer and camera, without re-attaching the listeners on every render
  const latest = useRef({ camera, consumer });
  latest.current = { camera, consumer };
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const pipe = createPointerPipeline(
      animationFrames,
      (info) => latest.current.consumer.deliver(info),
      () => latest.current.consumer.frameEnd?.(),
    );
    const to: Feed = { pipe, el, camera: () => latest.current.camera() };
    const handlers = PHASES.map(([type, phase]) => [type, (e: Event) => feed(to, phase, e as PointerEvent)] as const);
    for (const [type, handler] of handlers) el.addEventListener(type, handler);
    return () => {
      for (const [type, handler] of handlers) el.removeEventListener(type, handler);
      pipe.dispose();
    };
  }, [ref]);
}
