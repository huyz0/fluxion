// The canvas (FR-EDT-002): the screen drawn by <ScreenView> through the session camera, panned by the
// wheel, space-drag and middle-drag, zoomed by ctrl/meta + wheel (a trackpad pinch; Safari's pinch
// sends gesture events instead), and by the keymap's camera commands (editor-keys.tsx);
// and the toolbar's zoom controls. What input does to the camera is pure (canvas-input.ts); this is
// the DOM glue. Pointer input comes through the frame-batched pipeline (pointer-input.ts) to the
// tools, but for the middle button and space-drag, which pan whatever the tool.
import type { Store } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import { useElementBox } from '@fluxion/player';
import { type AssetUrls, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type MouseEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef } from 'react';
import { type Camera, fitBox, panBy, screenToPage, ZOOM_LIMITS, zoomAt, zoomBy, zoomTo100 } from './camera.js';
import { wheelCamera, ZOOM_STEP } from './canvas-input.js';
import { isEditable } from './editor-keys.js';
import { enterGroup } from './group-edit.js';
import { InlineTextEditor } from './inline-text-editor.js';
import { Overlay, useOverlayShown } from './overlay.js';
import { placements, selectionBounds } from './overlay-geometry.js';
import type { Execute, PointerInfo } from './pointer.js';
import { type PointerConsumer, usePointerInput } from './pointer-input.js';
import type { Session } from './session.js';
import { hasText } from './text-edit.js';
import { SELECT_TOOL, type ToolDispatcher } from './tools.js';
import { CONTEXT_MENU_EVENT } from './touch.js';
import { touchConsumer } from './touch-input.js';

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

/** Space pressed: held for space-drag; a focused button keeps its own space. */
function holdSpace(e: KeyboardEvent, space: RefObject<boolean>): void {
  if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
  space.current = true;
}

/**
 * Space held for space-drag, on the window while the canvas is mounted, and the tools cancelled when
 * the window loses focus. Every other key is the keymap's (editor-keys.tsx, M7.4).
 */
function useSpace(space: RefObject<boolean>, tools: ToolDispatcher | undefined): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // a key typed into a field, or taken already, is not the canvas's
      if (e.key === ' ' && !e.defaultPrevented && !isEditable(e.target)) holdSpace(e, space);
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
  }, [space, tools]);
}

/** Props of {@link Canvas}. */
export type CanvasProps = {
  /** The URLs of the assets the views draw. */
  readonly assets?: AssetUrls | undefined;
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
  /** Runs a command (the inline text editor writes through it; without, text cannot be edited in place). */
  readonly execute?: Execute | undefined;
  /** Told the canvas size whenever it changes. */
  readonly onBox: (box: Viewport) => void;
  /** Told where a context menu is asked for: a right click, or a finger held still. */
  readonly onMenu?: ((asked: MenuAsked) => void) | undefined;
};

/**
 * Where a context menu was asked for.
 *
 * @public
 */
export type MenuAsked = {
  /** The canvas point, px. */
  readonly screen: Vec2;
  /** The page point. */
  readonly page: Vec2;
  /** The window point, client px. */
  readonly client: Vec2;
};

/** Hand the menus asked for on the canvas `ref` (as {@link CONTEXT_MENU_EVENT}) to `onMenu`. */
function useMenuEvents(ref: RefObject<HTMLElement | null>, onMenu: ((asked: MenuAsked) => void) | undefined): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null || onMenu === undefined) return;
    const listener = (e: Event) => {
      const { screen, page } = (e as CustomEvent<{ screen: Vec2; page: Vec2 }>).detail;
      const r = el.getBoundingClientRect();
      onMenu({ screen, page, client: { x: r.left + screen.x, y: r.top + screen.y } });
    };
    el.addEventListener(CONTEXT_MENU_EVENT, listener);
    return () => el.removeEventListener(CONTEXT_MENU_EVENT, listener);
  }, [ref, onMenu]);
}

/** A right click asks for the context menu where it is, as a finger held still does; the browser's own menu does not open. */
function askMenu(e: MouseEvent<HTMLElement>, session: Session): void {
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
  e.currentTarget.dispatchEvent(new CustomEvent(CONTEXT_MENU_EVENT, { bubbles: true, detail: { screen, page: screenToPage(session.camera.get(), screen) } }));
}

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

/**
 * A double-click on a group enters it, to edit its members (Esc leaves it); on an element with text it opens the
 * text for editing in place (the select tool, between gestures).
 */
function editAt(e: MouseEvent<HTMLElement>, session: Session, tools: ToolDispatcher | undefined): void {
  if (tools === undefined || tools.current !== `${SELECT_TOOL}.idle`) return;
  const r = e.currentTarget.getBoundingClientRect();
  const at = screenToPage(session.camera.get(), { x: e.clientX - r.left, y: e.clientY - r.top });
  const hit = tools.ctx.hitTest(at);
  if (hit !== undefined && enterGroup(tools.ctx, hit, at)) return;
  if (hit === undefined || !hasText(tools.ctx.view, hit)) return;
  session.selection.set([hit]);
  session.editing.set(hit);
}

/** The canvas: the screen at the session camera, panned and zoomed. */
export function Canvas(props: CanvasProps): ReactNode {
  const { store, registries, screenId, area, session, tools, execute, assets, onBox, onMenu } = props;
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
  useSpace(space, tools);
  useMenuEvents(ref, onMenu);
  // one consumer for the canvas's life: the fingers down are its state
  const consumer = useMemo(
    () =>
      touchConsumer(canvasConsumer(session, space, drag, tools), {
        session,
        tools,
        timer: (ms, fn) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        },
        // the context-menu hook (M7's menus listen for it): where a finger was held
        onLongPress: (i) => ref.current?.dispatchEvent(new CustomEvent(CONTEXT_MENU_EVENT, { bubbles: true, detail: { screen: i.screen, page: i.page } })),
      }),
    [session, tools],
  );
  usePointerInput(ref, session.camera.get, consumer);
  const overlay = useOverlayShown(session);
  return (
    <main
      ref={ref}
      aria-label="Canvas"
      className="fx-chrome-canvas"
      tabIndex={-1}
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      // nothing on the canvas is under a pointer that has left it (M6.11 review F1)
      onPointerLeave={() => session.hover.set(undefined)}
      onDoubleClick={(e) => editAt(e, session, tools)}
      onContextMenu={(e) => askMenu(e, session)}
    >
      {screenId === undefined || box.w === 0 ? null : (
        <>
          <ScreenView
            store={store}
            screenId={screenId}
            mode="edit"
            view={{ kind: 'camera', box, camera }}
            registries={registries}
            {...(assets === undefined ? {} : { assets })}
          />
          {overlay ? <Overlay store={store} session={session} box={box} shapeDefs={registries.shapeDefs} routes={registries} /> : null}
          {execute === undefined ? null : <InlineTextEditor store={store} registries={registries} session={session} execute={execute} />}
        </>
      )}
    </main>
  );
}

/** Props of {@link ZoomControls}. */
export type ZoomControlsProps = {
  /** The document store (the selection's bounds, for zoom to selection). */
  readonly store: Store;
  /** The session whose camera they move. */
  readonly session: Session;
  /** The canvas size. */
  readonly box: Viewport;
  /** The screen's area, for fit. */
  readonly area: Box | undefined;
};

/** The toolbar's zoom controls: out, the zoom as a percentage, in, fit, zoom to selection, 100 %. */
export function ZoomControls(props: ZoomControlsProps): ReactNode {
  const { store, session, box, area } = props;
  const camera = useValue(session.camera.get);
  const selection = useValue(session.selection.get);
  // nothing placed selected (none, or connectors only): nothing to fit, the control is disabled
  const bounds = useValue(useMemo(() => store.query((view) => selectionBounds(placements(view, selection))), [store, selection]));
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
      <button
        type="button"
        className="fx-chrome-button"
        aria-label="Zoom to selection"
        disabled={bounds === undefined}
        onClick={() => bounds && set(fitBox(bounds, box))}
      >
        Selection
      </button>
      <button type="button" className="fx-chrome-button" onClick={() => set(zoomTo100(camera, box))}>
        100 %
      </button>
    </fieldset>
  );
}
