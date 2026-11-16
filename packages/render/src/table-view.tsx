// The view of a `table` element (FR-SHP-014, ADR-0054): each cell a box at its place in the grid (merged cells span theirs), filled
// and bordered in the style it resolves (table-layout.ts), with its rich text inside. A border is centred on the cell's edge, so two
// neighbours' borders draw one line. Drawn in the box's own coordinates, the same in edit, present and export.
import type { Style, TableElement } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { paintCss } from './background.js';
import { labelStyle } from './label.js';
import type { ElementViewProps } from './registries.js';
import { RichText } from './rich-text.js';
import { tableCellStyle, tableCells } from './table-layout.js';

/** Space between a cell's edge and its text, px. */
const CELL_PADDING_PX = 6;

/**
 * The CSS of the text of a cell on `row` of `table` whose own style is `style`: its resolved font and the space to its edge. The
 * view draws a cell's text with it, and the editor's in-place cell editor lays its text the same way (M19.43).
 *
 * @public
 */
export function tableCellLabel(table: Pick<TableElement, 'id' | 'tableStyle'>, row: number, style: Style | undefined, theme: Theme): CSSProperties {
  return { ...labelStyle(tableCellStyle(table, row, style, theme).font, '1'), padding: CELL_PADDING_PX };
}

/**
 * The built-in view for `table` elements.
 *
 * @public
 */
export function TableView(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const table = props.element as TableElement;
  const { w, h } = table.transform;
  const cells = useMemo(() => tableCells(table, { w, h }), [table, w, h]);
  return (
    <>
      <div className="fx-table" style={{ position: 'absolute', inset: 0 }}>
        {cells.map((box) => {
          const cell = table.cells[box.key];
          const style = tableCellStyle(table, box.row, cell?.style, theme);
          const border = style.stroke.width;
          return (
            <div
              key={box.key}
              className="fx-table-cell"
              data-cell={box.key}
              style={{
                position: 'absolute',
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                boxSizing: 'border-box',
                ...paintCss(style.fill),
                outline: `${border} solid ${style.stroke.color}`,
                outlineOffset: `calc(${border} / -2)`,
                // the cell's opacity fades its fill, border and text together, as a shape's does
                opacity: style.opacity,
              }}
            >
              {cell?.text === undefined ? null : (
                <div className="fx-label" style={tableCellLabel(table, box.row, cell?.style, theme)}>
                  <RichText doc={cell.text} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {props.children}
    </>
  );
}
