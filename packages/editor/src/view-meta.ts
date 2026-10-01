// What undo and redo bring back besides the document (FR-EDT-006, M7.7, ADR-0014): the screen the
// edit was made on, what was selected, and the camera. The editor attaches a snapshot to each write as
// the transaction's `metaBefore` / `metaAfter`; core keeps them opaque, and `undo()` / `redo()` hand
// the right one back. Pure: it reads and writes the session only.
import type { RecordId } from '@fluxion/schema';
import { type Camera, clampZoom } from './camera.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/**
 * The view around an edit.
 *
 * @public
 */
export type ViewMeta = {
  /** The screen shown. */
  readonly screen: RecordId | undefined;
  /** The selected elements. */
  readonly selection: readonly RecordId[];
  /** Where the canvas looked. */
  readonly camera: Camera;
};

/**
 * The view now: `shown` is the screen the canvas shows.
 *
 * @public
 */
export const snapshotView = (session: Session, shown: RecordId | undefined): ViewMeta => ({
  screen: shown,
  selection: session.selection.get(),
  camera: session.camera.get(),
});

const isNumber = (v: unknown): v is number => Number.isFinite(v);

/**
 * The view in a history entry's meta, or undefined when it is none (an entry written by another host,
 * or damaged): undo then restores nothing but the document.
 *
 * @public
 */
export function readViewMeta(value: unknown): ViewMeta | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { screen, selection, camera } = value as { screen?: unknown; selection?: unknown; camera?: unknown };
  if (!Array.isArray(selection) || !selection.every((id) => typeof id === 'string')) return undefined;
  if (screen !== undefined && typeof screen !== 'string') return undefined;
  const c = camera as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
  if (typeof c !== 'object' || c === null || !isNumber(c.x) || !isNumber(c.y) || !isNumber(c.z)) return undefined;
  return { screen: screen as RecordId | undefined, selection: selection as RecordId[], camera: { x: c.x, y: c.y, z: clampZoom(c.z) } };
}

/**
 * Show the view `meta` again: the selection (what no longer exists is dropped), and, when the edit was
 * made on another screen than the one shown, that screen with the camera it was edited in. On the same
 * screen the camera stays where the user put it.
 *
 * @public
 */
export function restoreView(session: Session, meta: ViewMeta, shown: RecordId | undefined, exists: (id: RecordId) => boolean): void {
  if (meta.screen !== undefined && meta.screen !== shown && exists(meta.screen)) {
    session.screen.set(meta.screen);
    session.camera.set(meta.camera);
  }
  session.selection.set(meta.selection.filter(exists));
}

/**
 * `execute` with each write carrying the view around it: the view before is `metaBefore`, and the view
 * after is `metaAfter`, filled in once the tool that made the write has finished with the selection
 * (the end of the current task). A caller's own meta is kept. Redo shows the edit's screen again.
 *
 * @public
 */
export function withViewMeta(execute: Execute, session: Session, shown: () => RecordId | undefined): Execute {
  return (id, args, options) => {
    const before = snapshotView(session, shown());
    // the object history keeps: refreshed below, after the tool has set the selection it ends with
    const after: { -readonly [K in keyof ViewMeta]: ViewMeta[K] } = { ...before };
    queueMicrotask(() => {
      after.selection = session.selection.get();
      after.camera = session.camera.get();
    });
    return execute(id, args, { ...options, metaBefore: options?.metaBefore ?? before, metaAfter: options?.metaAfter ?? after });
  };
}
