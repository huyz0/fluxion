// The overlay's mark for the picked cells of a table (FR-SHP-014): the rectangle the range covers, merged cells it touches
// included, drawn on the table's placement in screen space.
import { coveringArea, type Store } from '@fluxion/core';
import { apply, elementMatrix, type Vec2 } from '@fluxion/geometry';
import { tableCells, useValue } from '@fluxion/render';
import { type ReactNode, useMemo } from 'react';
import { pageToScreen } from './camera.js';
import type { Session } from './session.js';
import { fitRange, tableOf } from './table-edit.js';

/** Props of {@link TableMarks}. */
export type TableMarksProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose picked cells and camera it draws. */
  readonly session: Session;
};

/** The page corners of the picked range of the one selected table; none when no cell is picked. */
function usePickedCorners(store: Store, session: Session): readonly Vec2[] {
  const range = useValue(session.tableCells.get);
  return useValue(
    useMemo(
      () =>
        store.query((view): readonly Vec2[] => {
          const table = range === undefined ? undefined : tableOf(view, range.id);
          if (table === undefined || range === undefined) return [];
          const area = coveringArea(table, fitRange(table, range));
          const { w, h } = table.transform;
          const boxes = tableCells(table, { w, h }).filter((c) => c.row >= area.row && c.row <= area.toRow && c.col >= area.col && c.col <= area.toCol);
          if (boxes.length === 0) return [];
          const [x0, y0] = [Math.min(...boxes.map((c) => c.x)), Math.min(...boxes.map((c) => c.y))];
          const [x1, y1] = [Math.max(...boxes.map((c) => c.x + c.w)), Math.max(...boxes.map((c) => c.y + c.h))];
          const m = elementMatrix({ ...table.transform, rot: table.transform.rot ?? 0 });
          return [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ].map((p) => apply(m, p));
        }),
      [store, range],
    ),
  );
}

/** The outline of the picked table cells. */
export function TableMarks(props: TableMarksProps): ReactNode {
  const camera = useValue(props.session.camera.get);
  const corners = usePickedCorners(props.store, props.session);
  if (corners.length === 0) return null;
  const pts = corners.map((p) => pageToScreen(camera, p)).map((p) => `${p.x},${p.y}`);
  return <polygon className="fx-chrome-table-cells" data-table-cells="true" points={pts.join(' ')} />;
}
