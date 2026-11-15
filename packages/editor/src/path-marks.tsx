// The overlay's marks for the path being edited (FR-SHP-011): each bezier handle on a line from its vertex, and each
// vertex, the selected one filled. Screen space, constant size at any zoom.
import { lockedWithin, type Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { pageToScreen } from './camera.js';
import { HANDLE_PX } from './overlay-geometry.js';
import { type PlacedPathHandle, pathTarget, placedPathHandles } from './path-edit.js';
import type { Session } from './session.js';

/** Props of {@link PathMarks}. */
export type PathMarksProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose path editing, selection and camera it draws. */
  readonly session: Session;
};

/** The handles of the path being edited, when it is the whole selection. */
function useEditedHandles(store: Store, session: Session): readonly PlacedPathHandle[] {
  const editing = useValue(session.pathEdit.get);
  const selection = useValue(session.selection.get);
  const id = editing !== undefined && selection.length === 1 && selection[0] === editing.id ? editing.id : undefined;
  return useValue(
    useMemo(
      () =>
        store.query((view): readonly PlacedPathHandle[] => {
          // a path locked against reshaping (M19.15) shows no handles to drag
          const locked = id !== undefined && (['edit', 'size', 'position'] as const).some((lock) => lockedWithin(view, id as RecordId, lock));
          const target = id === undefined || locked ? undefined : pathTarget(view, id as RecordId);
          return target === undefined ? [] : placedPathHandles(target);
        }),
      [store, id],
    ),
  );
}

/** The vertices and bezier handles of the path being edited. */
export function PathMarks(props: PathMarksProps): ReactNode {
  const { store, session } = props;
  const camera = useValue(session.camera.get);
  const point = useValue(session.pathEdit.get)?.point;
  const handles = useEditedHandles(store, session);
  if (handles.length === 0) return null;
  const half = HANDLE_PX / 2;
  const screen = (p: { readonly x: number; readonly y: number }) => pageToScreen(camera, p);
  return (
    <g className="fx-chrome-path-edit">
      {handles.flatMap((h) => {
        if (h.vertex === undefined) return [];
        const [a, b] = [screen(h.vertex), screen(h.page)];
        const key = `${h.handle.kind}-${h.handle.sub}-${h.handle.index}`;
        return [
          <line key={`line-${key}`} className="fx-chrome-path-arm" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />,
          <circle key={key} className="fx-chrome-path-control" data-path-handle={key} cx={b.x} cy={b.y} r={half - 1} />,
        ];
      })}
      {handles.flatMap((h) => {
        if (h.handle.kind !== 'vertex') return [];
        const at = screen(h.page);
        const selected = point?.sub === h.handle.sub && point.index === h.handle.index;
        return [
          <rect
            key={`vertex-${h.handle.sub}-${h.handle.index}`}
            className={selected ? 'fx-chrome-path-vertex fx-chrome-path-vertex-selected' : 'fx-chrome-path-vertex'}
            data-path-vertex={`${h.handle.sub}-${h.handle.index}`}
            x={at.x - half}
            y={at.y - half}
            width={HANDLE_PX}
            height={HANDLE_PX}
          />,
        ];
      })}
    </g>
  );
}
