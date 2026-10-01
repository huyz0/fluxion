// Present in place (FR-EDT-009, 04 §3.8): F5 swaps the editor for the screen presented, fitted to the
// window, with no edit chrome (no panels, overlay, selection or hover); Esc or F5 again returns. While
// presenting the pointer goes to the present-mode tools (the laser) and every write is refused (the
// read-only guard, FR-PRS-004); keys edit nothing: the keymap's edit bindings do not apply there. The
// laser's trail is drawn above the screen's elements (04 §2.1 overlays layer, player's LaserTrail).
import type { Store } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { LaserTrail, useElementBox } from '@fluxion/player';
import { type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePointerInput } from './pointer-input.js';
import { fitCamera } from './present-mode.js';
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
 * The switch between editing and presenting in place (F5, shift+F5 and Esc bind to it through the
 * keymap's `mode.toggle`, M7.4): the edit tool is saved on the way in and put back on the way out.
 *
 * @public
 */
export function useModeSwitch(session: Session, edit: ToolDispatcher, present: ToolDispatcher): () => void {
  const saved = useRef(session.tool.get());
  return useCallback(() => switchMode(session, session.mode.get() === 'present' ? present : edit, saved), [session, edit, present]);
}

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
  const { store, registries, screenId, area, session, tools } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const laser = useValue(session.laser.get);
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
        <ScreenView store={store} screenId={screenId} mode="present" view={{ kind: 'fit', box }} registries={registries}>
          <LaserTrail points={laser} scale={camera.z} />
        </ScreenView>
      )}
    </div>
  );
}
