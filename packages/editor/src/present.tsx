// Present in place (FR-EDT-009, 04 §3.8): F5 swaps the editor for the screen presented, fitted to the
// window, with no edit chrome (no panels, overlay, selection or hover); Esc or F5 again returns. While
// presenting the pointer goes to the present-mode tools (the laser) and every write is refused (the
// read-only guard, FR-PRS-004); keys edit nothing: the keymap's edit bindings do not apply there. The
// laser's trail is drawn above the screen's elements (04 §2.1 overlays layer, player's LaserTrail).
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { LaserTrail, useElementBox } from '@fluxion/player';
import { type AssetUrls, presentationOrder, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import { isMasterScreen, type RecordId } from '@fluxion/schema';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePointerInput } from './pointer-input.js';
import { fitCamera } from './present-mode.js';
import { usePresentNav } from './present-nav.js';
import { shownScreen, switchScreen } from './screen-switch.js';
import { DEFAULT_CAMERA, type Session } from './session.js';
import type { ToolDispatcher } from './tools.js';

/**
 * How many transactions `store` has committed since this hook first ran: a document that is not
 * written keeps its revision (the editor root shows it as `data-revision`).
 *
 * @public
 */
export function useRevision(store: Store): number {
  const count = useRef(0);
  const subscribe = useMemo(
    () => (changed: () => void) =>
      store.subscribe(() => {
        count.current += 1;
        changed();
      }),
    [store],
  );
  return useSyncExternalStore(subscribe, () => count.current);
}

/**
 * Where presenting `from` starts: F5 (`start`) from the first visible screen; shift+F5 from the shown one, unless it is a master,
 * which is never presented: then from the first visible screen too (FR-EDT-009, FR-SCR-005). Undefined keeps the shown screen;
 * null is nothing to present (the shown screen a master, no screen visible).
 */
function startOf(store: Store, session: Session, from: 'start' | 'current'): RecordId | undefined | null {
  // the screen the canvas shows: an unset or gone one is the document's first, which may be a master
  const shown = shownScreen(store, session.screen.get());
  const onMaster = shown !== undefined && isMasterScreen(store.get(shown));
  if (from !== 'start' && !onMaster) return undefined;
  const first = presentationOrder(store, false)[0];
  return first === undefined && onMaster ? null : first;
}

/**
 * The switch between editing and presenting in place (F5, shift+F5 and Esc bind to it through the
 * keymap's `mode.toggle`, M7.4): the edit tool is saved on the way in and put back on the way out.
 *
 * @public
 */
export function useModeSwitch(store: Store, session: Session, edit: ToolDispatcher, present: ToolDispatcher): ModeSwitch {
  const saved = useRef(session.tool.get());
  return useCallback(
    (from = 'current') => {
      const first = session.mode.get() === 'edit' ? startOf(store, session, from) : undefined;
      // a document whose every visible screen is a master has nothing to present: it stays in edit mode (M19.23 r1)
      if (first === null) return false;
      if (first !== undefined && first !== session.screen.get()) switchScreen(session, first);
      switchMode(session, session.mode.get() === 'present' ? present : edit, saved);
      return true;
    },
    [store, session, edit, present],
  );
}

/**
 * Switch between editing and presenting; entering `from` the first visible screen (`start`, F5) or the shown one (`current`).
 * False when it stayed in edit mode: nothing to present, the shown screen a master and no other visible.
 *
 * @public
 */
export type ModeSwitch = (from?: 'start' | 'current') => boolean;

/**
 * Switch between editing and presenting: what the leaving mode's tools were doing is cancelled, and
 * the edit tool is saved on the way in and put back on the way out.
 */
function switchMode(session: Session, leaving: ToolDispatcher, saved: { current: string }): void {
  leaving.cancel();
  if (session.mode.get() === 'present') {
    session.mode.set('edit');
    session.tool.set(saved.current);
  } else {
    saved.current = session.tool.get();
    session.mode.set('present');
  }
}

/**
 * Props of {@link PresentInPlace}.
 *
 * @public
 */
export type PresentInPlaceProps = {
  /** The URLs of the assets the views draw. */
  readonly assets?: AssetUrls | undefined;
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** The screen presented. */
  readonly screenId: RecordId | undefined;
  /** Its area. */
  readonly area: Box | undefined;
  /** The session: its laser trail is drawn. */
  readonly session: Session;
  /** The present-mode tools, whose writes are refused. */
  readonly tools: ToolDispatcher;
};

/**
 * The screen presented in place: fitted to the window, the laser drawn, no edit chrome.
 *
 * @public
 */
export function PresentInPlace(props: PresentInPlaceProps): ReactNode {
  const { store, registries, screenId, area, session, tools, assets } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const laser = useValue(session.laser.get);
  const hidden = usePresentNav(store, session);
  const camera = area !== undefined && box.w > 0 ? fitCamera(area, box) : DEFAULT_CAMERA;
  const latest = useRef(camera);
  latest.current = camera;
  const consumer = useMemo(
    () => ({ deliver: (i: Parameters<ToolDispatcher['pointer']>[0]) => (tools.pointer(i) && i.phase === 'down') || undefined }),
    [tools],
  );
  usePointerInput(ref, () => latest.current, consumer);
  // the pointer leaving the stage takes its trail with it
  useEffect(() => {
    const el = ref.current;
    const leave = () => tools.cancel();
    el?.addEventListener('pointerleave', leave);
    return () => el?.removeEventListener('pointerleave', leave);
  }, [tools]);
  return (
    <div ref={ref} className="fx-present" data-testid="present-in-place" style={{ position: 'fixed', inset: 0, background: '#000', touchAction: 'none' }}>
      {screenId === undefined || box.w === 0 ? null : (
        <ScreenView
          store={store}
          screenId={screenId}
          mode="present"
          view={{ kind: 'fit', box }}
          registries={registries}
          {...(assets === undefined ? {} : { assets })}
          {...(hidden === undefined ? {} : { hidden })}
        >
          <LaserTrail points={laser} scale={camera.z} />
        </ScreenView>
      )}
    </div>
  );
}
