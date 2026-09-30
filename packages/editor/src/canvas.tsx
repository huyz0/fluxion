// The canvas (FR-EDT-002): the screen drawn by <ScreenView> through the session camera, panned by the
// wheel, space-drag and middle-drag, zoomed by ctrl/meta + wheel (a trackpad pinch; Safari's pinch
// sends gesture events instead) and shortcuts;
// and the toolbar's zoom controls. What input does to the camera is pure (canvas-input.ts); this is
// the DOM glue. Pointer input comes through the frame-batched pipeline (pointer-input.ts) to the
// tools, but for the middle button and space-drag, which pan whatever the tool.
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { useElementBox } from '@fluxion/player';
import { type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { type Camera, fitBox, panBy, ZOOM_LIMITS, zoomAt, zoomBy, zoomTo100 } from './camera.js';
import { shortcutCamera, wheelCamera, ZOOM_STEP } from './canvas-input.js';
import { Overlay } from './overlay.js';
import type { PointerInfo } from './pointer.js';
import { type PointerConsumer, usePointerInput } from './pointer-input.js';
import type { Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

/** Whether `target` takes text (keys typed there are not canvas shortcuts). */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

type Viewport = { readonly w: number; readonly h: number };

/** Safari's trackpad pinch (non-standard `gesture*` events; other browsers send ctrl + wheel). */
type GestureEvent = UIEvent & { readonly scale: number; readonly clientX: number; readonly clientY: number };

/** A Safari pinch on the canvas zooms about the pinch point from the zoom it started at. */
function useGesture(ref: RefObject<HTMLElement | null>, session: Session): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let start = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      start = session.camera.get().z;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      const r = el.getBoundingClientRect();
      session.camera.set(zoomAt(session.camera.get(), { x: g.clientX - r.left, y: g.clientY - r.top }, start * g.scale));
    };
    el.addEventListener('gesturestart', onStart);
    el.addEventListener('gesturechange', onChange);
    return () => {
      el.removeEventListener('gesturestart', onStart);
      el.removeEventListener('gesturechange', onChange);
    };
  }, [ref, session]);
}

/** Wheel on the canvas: non-passive, so the page never scrolls or zooms instead. */
function useWheel(ref: RefObject<HTMLElement | null>, session: Session, box: Viewport): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const input = {
        dx: e.deltaX,
        dy: e.deltaY,
        mode: e.deltaMode,
        zoom: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        at: { x: e.clientX - r.left, y: e.clientY - r.top },
      };
      session.camera.set(wheelCamera(session.camera.get(), input, box));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, session, box]);
}

/** The camera after the shortcut `e`, or undefined when it is none or the canvas has nothing to show. */
function shortcut(e: KeyboardEvent, session: Session, box: Viewport, area: Box | undefined) {
  if (area === undefined || box.w === 0) return undefined;
  const k = { key: e.key, code: e.code, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
  return shortcutCamera(session.camera.get(), k, box, area);
}

/** Space pressed: held for space-drag; a focused button keeps its own space. */
function holdSpace(e: KeyboardEvent, space: RefObject<boolean>): void {
  if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
  space.current = true;
}

/** A shortcut's camera, if it was one, taken instead of the browser's own meaning of the key. */
function applyShortcut(e: KeyboardEvent, session: Session, next: Camera | undefined): boolean {
  if (next === undefined) return false;
  e.preventDefault();
  session.camera.set(next);
  return true;
}

/** A key for the tools (Esc, their shortcuts, their states), taken when they take it. */
function toolKey(e: KeyboardEvent, tools: ToolDispatcher | undefined): void {
  if (tools?.key({ key: e.key, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey }) === true) e.preventDefault();
}

/** Space held (for space-drag), the camera shortcuts, then the tools' keys, on the window while the canvas is mounted. */
function useKeys(input: {
  readonly session: Session;
  readonly box: Viewport;
  readonly area: Box | undefined;
  readonly space: RefObject<boolean>;
  readonly tools: ToolDispatcher | undefined;
}): void {
  const { session, box, area, space, tools } = input;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === ' ') holdSpace(e, space);
      else if (!applyShortcut(e, session, shortcut(e, session, box, area))) toolKey(e, tools);
    };
    const release = (e: Event) => {
      if (e.type === 'blur' || (e as KeyboardEvent).key === ' ') space.current = false;
      // losing the window ends what the tool was doing
      if (e.type === 'blur') tools?.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', release);
    };
  }, [session, box, area, space, tools]);
}

/** Props of {@link Canvas}. */
export type CanvasProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** The screen shown, if the document has one. */
  readonly screenId: RecordId | undefined;
  /** Its area in page coordinates. */
  readonly area: Box | undefined;
  /** The session whose camera it draws through. */
  readonly session: Session;
  /** The tools that take the pointer and keys (none: the canvas only pans and zooms). */
  readonly tools?: ToolDispatcher | undefined;
  /** Told the canvas size whenever it changes. */
  readonly onBox: (box: Viewport) => void;
};

type Drag = { readonly pointerId: number; x: number; y: number };

/**
 * The canvas's pointer input: a middle press, or a primary press with space held, pans whatever the
 * tool (the camera moving once per frame with the latest point); anything else goes to the tools.
 */
function canvasConsumer(session: Session, space: RefObject<boolean>, drag: RefObject<Drag | undefined>, tools: ToolDispatcher | undefined): PointerConsumer {
  const pan = (i: PointerInfo, d: Drag) => {
    if (i.phase !== 'move') drag.current = undefined;
    else {
      session.camera.set(panBy(session.camera.get(), { x: i.screen.x - d.x, y: i.screen.y - d.y }));
      d.x = i.screen.x;
      d.y = i.screen.y;
    }
    return undefined;
  };
  return {
    deliver: (i) => {
      if (i.phase === 'down' && (i.button === 1 || (i.button === 0 && space.current))) {
        drag.current = { pointerId: i.pointerId, x: i.screen.x, y: i.screen.y };
        // taken: a middle click would otherwise start the browser's autoscroll or paste
        return true;
      }
      const d = drag.current;
      if (d?.pointerId === i.pointerId) return pan(i, d);
      // a press a tool takes is not also the browser's (text selection, dragging an image)
      return tools?.pointer(i) === true && i.phase === 'down' ? true : undefined;
    },
  };
}

/** The canvas: the screen at the session camera, panned and zoomed. */
export function Canvas(props: CanvasProps): ReactNode {
  const { store, registries, screenId, area, session, tools, onBox } = props;
  const ref = useRef<HTMLElement>(null);
  const box = useElementBox(ref);
  const camera = useValue(session.camera.get);
  const space = useRef(false);
  const drag = useRef<Drag | undefined>(undefined);
  useEffect(() => {
    onBox(box);
  }, [box, onBox]);
  useWheel(ref, session, box);
  useGesture(ref, session);
  useKeys({ session, box, area, space, tools });
  usePointerInput(ref, session.camera.get, canvasConsumer(session, space, drag, tools));
  return (
    <main
      ref={ref}
      aria-label="Canvas"
      className="fx-chrome-canvas"
      tabIndex={-1}
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      // nothing on the canvas is under a pointer that has left it (M6.11 review F1)
      onPointerLeave={() => session.hover.set(undefined)}
    >
      {screenId === undefined || box.w === 0 ? null : (
        <>
          <ScreenView store={store} screenId={screenId} mode="edit" view={{ kind: 'camera', box, camera }} registries={registries} />
          <Overlay store={store} session={session} box={box} />
        </>
      )}
    </main>
  );
}

/** Props of {@link ZoomControls}. */
export type ZoomControlsProps = {
  /** The session whose camera they move. */
  readonly session: Session;
  /** The canvas size. */
  readonly box: Viewport;
  /** The screen's area, for fit. */
  readonly area: Box | undefined;
};

/** The toolbar's zoom controls: out, the zoom as a percentage, in, fit, 100 %. */
export function ZoomControls(props: ZoomControlsProps): ReactNode {
  const { session, box, area } = props;
  const camera = useValue(session.camera.get);
  const centre = { x: box.w / 2, y: box.h / 2 };
  const set = (next: typeof camera) => session.camera.set(next);
  return (
    <fieldset className="fx-chrome-zoom" aria-label="Zoom">
      <button
        type="button"
        className="fx-chrome-button"
        aria-label="Zoom out"
        disabled={camera.z <= ZOOM_LIMITS.min}
        onClick={() => set(zoomBy(camera, centre, 1 / ZOOM_STEP))}
      >
        −
      </button>
      <output className="fx-chrome-zoom-value" aria-live="polite">{`${Math.round(camera.z * 100)} %`}</output>
      <button
        type="button"
        className="fx-chrome-button"
        aria-label="Zoom in"
        disabled={camera.z >= ZOOM_LIMITS.max}
        onClick={() => set(zoomBy(camera, centre, ZOOM_STEP))}
      >
        +
      </button>
      <button type="button" className="fx-chrome-button" disabled={area === undefined} onClick={() => area && set(fitBox(area, box))}>
        Fit
      </button>
      <button type="button" className="fx-chrome-button" onClick={() => set(zoomTo100(camera, box))}>
        100 %
      </button>
    </fieldset>
  );
}
