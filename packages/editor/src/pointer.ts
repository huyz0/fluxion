// The pointer pipeline (FR-EDT-003, ADR-0028, 04 §3.1): raw pointer events become `PointerInfo`
// (canvas and page points through the camera, buttons, modifiers, pressure); moves are coalesced and
// delivered once per animation frame; a gesture writes one command per frame (the only write path,
// ADR-0014), all under one merge key so the gesture is one undo step, and the history is sealed when
// it ends.
// Pure: the frame scheduler is injected, so tests drive frames by hand.
import type { CommandFailure, CommandTxOptions } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { Result } from '@fluxion/schema';
import { type Camera, screenToPage } from './camera.js';

/**
 * The phase of a pointer event.
 *
 * @public
 */
export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

/**
 * A pointer event as tools see it.
 *
 * @public
 */
export type PointerInfo = {
  /** What happened. */
  readonly phase: PointerPhase;
  /** The pointer's id (one per finger or pen). */
  readonly pointerId: number;
  /** `mouse`, `pen` or `touch`. */
  readonly pointerType: string;
  /** Where it is on the canvas, px from its top-left. */
  readonly screen: Vec2;
  /** Where it is on the page, through the camera. */
  readonly page: Vec2;
  /** The button that changed (`PointerEvent.button`: 0 primary, 1 middle, 2 secondary; -1 none). */
  readonly button: number;
  /** The buttons held (`PointerEvent.buttons` bit mask). */
  readonly buttons: number;
  /** Shift held. */
  readonly shift: boolean;
  /** Alt held. */
  readonly alt: boolean;
  /** Ctrl or meta held. */
  readonly mod: boolean;
  /** Pen or touch pressure, 0-1 (0.5 for a mouse with a button down). */
  readonly pressure: number;
  /** For a move: the moves it stands for since the last frame, oldest first, itself last. */
  readonly coalesced: readonly PointerInfo[];
};

/**
 * The fields of a DOM pointer event the pipeline reads.
 *
 * @public
 */
export type RawPointer = {
  /** Viewport x. */
  readonly clientX: number;
  /** Viewport y. */
  readonly clientY: number;
  /** `PointerEvent.pointerId`. */
  readonly pointerId: number;
  /** `PointerEvent.pointerType`. */
  readonly pointerType: string;
  /** `PointerEvent.button`. */
  readonly button: number;
  /** `PointerEvent.buttons`. */
  readonly buttons: number;
  /** Shift held. */
  readonly shiftKey: boolean;
  /** Alt held. */
  readonly altKey: boolean;
  /** Ctrl held. */
  readonly ctrlKey: boolean;
  /** Meta held. */
  readonly metaKey: boolean;
  /** `PointerEvent.pressure`. */
  readonly pressure: number;
};

/**
 * `raw` as a {@link PointerInfo} of `phase`, for a canvas whose top-left is at `origin` in the
 * viewport, seen through `camera`.
 *
 * @public
 */
export function pointerInfo(phase: PointerPhase, raw: RawPointer, origin: Vec2, camera: Camera): PointerInfo {
  const screen = { x: raw.clientX - origin.x, y: raw.clientY - origin.y };
  return {
    phase,
    pointerId: raw.pointerId,
    pointerType: raw.pointerType,
    screen,
    page: screenToPage(camera, screen),
    button: raw.button,
    buttons: raw.buttons,
    shift: raw.shiftKey,
    alt: raw.altKey,
    mod: raw.ctrlKey || raw.metaKey,
    pressure: raw.pressure,
    coalesced: [],
  };
}

/**
 * Runs a callback at the next animation frame; returns a function that cancels it.
 *
 * @public
 */
export type FrameScheduler = (callback: () => void) => () => void;

/**
 * The pipeline's input side.
 *
 * @public
 */
export type PointerPipeline = {
  /**
   * Take one event: a move waits for the frame; anything else flushes the waiting moves, then goes,
   * returning what `deliver` returned for it.
   */
  push(info: PointerInfo): boolean | undefined;
  /** Deliver the waiting moves now. */
  flush(): void;
  /** Drop the waiting moves and the scheduled frame. */
  dispose(): void;
};

/**
 * A pipeline that hands `deliver` every down, up and cancel at once, and per frame the latest move
 * of each pointer (with the moves it stands for in `coalesced`). `frameEnd` runs after each flush of
 * the waiting moves (each frame, and before every down, up or cancel), where a gesture commits the
 * writes queued since the last one.
 *
 * @public
 */
export function createPointerPipeline(
  schedule: FrameScheduler,
  deliver: (info: PointerInfo) => boolean | undefined,
  frameEnd: () => void = () => {},
): PointerPipeline {
  const waiting = new Map<number, PointerInfo[]>();
  let cancel: (() => void) | undefined;
  const flush = () => {
    cancel?.();
    cancel = undefined;
    const moves = [...waiting.values()];
    waiting.clear();
    for (const run of moves) deliver({ ...(run.at(-1) as PointerInfo), coalesced: run });
    frameEnd();
  };
  return {
    push: (info) => {
      if (info.phase !== 'move') {
        flush();
        return deliver(info);
      }
      waiting.set(info.pointerId, [...(waiting.get(info.pointerId) ?? []), info]);
      cancel ??= schedule(flush);
      return undefined;
    },
    flush,
    dispose: () => {
      cancel?.();
      cancel = undefined;
      waiting.clear();
    },
  };
}

/**
 * Runs a command with transaction options: `Core.execute`, the only write path (ADR-0014).
 *
 * @public
 */
export type Execute = (id: string, args: unknown, options?: CommandTxOptions) => Result<unknown, CommandFailure>;

/**
 * A gesture's writes to the store.
 *
 * @public
 */
export type Gesture = {
  /** The gesture's merge key (`gesture:<n>`). */
  readonly mergeKey: string;
  /**
   * Set this frame's command. A later call in the same frame replaces it: a tool computes the whole
   * change from the gesture's start, so the latest call carries it, and a frame is one transaction.
   */
  update(id: string, args: unknown): void;
  /** Run this frame's command, if any, under the gesture's merge key. */
  commit(): Result<unknown, CommandFailure> | undefined;
  /** Commit what is waiting, then seal the history: the gesture is one undo step. */
  end(): Result<unknown, CommandFailure> | undefined;
};

let gestures = 0;

/**
 * A new gesture writing through `execute`; `seal` closes its undo step (`store.history.seal`).
 *
 * @public
 */
export function beginGesture(execute: Execute, seal: () => void): Gesture {
  gestures += 1;
  const mergeKey = `gesture:${gestures}`;
  let pending: { readonly id: string; readonly args: unknown } | undefined;
  const commit = () => {
    const call = pending;
    pending = undefined;
    return call && execute(call.id, call.args, { mergeKey });
  };
  return {
    mergeKey,
    update: (id, args) => {
      pending = { id, args };
    },
    commit,
    end: () => {
      const result = commit();
      seal();
      return result;
    },
  };
}
