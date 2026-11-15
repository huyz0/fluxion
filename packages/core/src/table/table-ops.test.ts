import type { RichTextDoc } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { coveringArea, insertLine, mergeCells, removeLine, splitCell, stepCell, type TableGrid } from './table-ops.js';

const text = (s: string): RichTextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] }) as RichTextDoc;

/** A 3 × 3 grid whose cell 0:1 spans two columns and 1:0 two rows. */
const grid: TableGrid = {
  rows: [{ h: 1 }, { h: 2 }, { h: 1 }],
  cols: [{ w: 1 }, { w: 1 }, { w: 3 }],
  cells: { '0:0': { text: text('a') }, '0:1': { colSpan: 2, text: text('b') }, '1:0': { rowSpan: 2 }, '2:2': { text: text('z') } },
};

describe('table editing operations (FR-SHP-014, ADR-0054)', () => {
  it("FR-SHP-014: inserting a line copies its neighbour's weight, shifts the cells after it and widens a merged cell it falls in", () => {
    const cols = insertLine(grid, 'col', 2);
    expect(cols?.cols).toEqual([{ w: 1 }, { w: 1 }, { w: 3 }, { w: 3 }]);
    expect(cols?.cells).toEqual({ '0:0': grid.cells['0:0'], '0:1': { colSpan: 3, text: text('b') }, '1:0': { rowSpan: 2 }, '2:3': { text: text('z') } });
    // appended after the last line; before the first, every cell moves
    expect(insertLine(grid, 'row', 3)?.rows).toHaveLength(4);
    expect(Object.keys(insertLine(grid, 'row', 0)?.cells ?? {}).sort()).toEqual(['1:0', '1:1', '2:0', '3:2']);
    // a merged cell starting on the line inserted before moves and keeps its span
    expect(insertLine(grid, 'row', 1)?.cells['2:0']).toEqual({ rowSpan: 2 });
    expect(insertLine(grid, 'row', -1)).toBeUndefined();
    expect(insertLine(grid, 'row', 4)).toBeUndefined();
    expect(insertLine({ rows: Array(500).fill({ h: 1 }), cols: [{ w: 1 }], cells: {} }, 'row', 0)).toBeUndefined();
  });

  it('FR-SHP-014: removing a line drops its one-line cells, narrows a merged cell across it and shifts the cells after it', () => {
    const rows = removeLine(grid, 'row', 1);
    expect(rows?.rows).toEqual([{ h: 1 }, { h: 1 }]);
    // the merged cell starting on the removed line stays, one line thinner, on the line that takes its place
    expect(rows?.cells).toEqual({ '0:0': grid.cells['0:0'], '0:1': grid.cells['0:1'], '1:0': {}, '1:2': { text: text('z') } });
    expect(removeLine(grid, 'col', 1)?.cells['0:1']).toEqual({ text: text('b') });
    expect(removeLine({ rows: [{ h: 1 }], cols: [{ w: 1 }], cells: {} }, 'row', 0)).toBeUndefined();
    expect(removeLine(grid, 'col', 3)).toBeUndefined();
  });

  it('FR-SHP-014: a range touching part of a merged cell grows to hold all of it, until nothing more is cut', () => {
    expect(coveringArea(grid, { row: 0, col: 2, toRow: 0, toCol: 2 })).toEqual({ row: 0, col: 1, toRow: 0, toCol: 2 });
    // a range given backwards is put in order; one already holding the merged cell stays as it is
    expect(coveringArea(grid, { row: 2, col: 1, toRow: 1, toCol: 0 })).toEqual({ row: 1, col: 0, toRow: 2, toCol: 1 });
  });

  it('FR-SHP-014: merging joins the texts in reading order into the first cell, and splitting gives the grid cells back', () => {
    const merged = mergeCells(grid, { row: 0, col: 0, toRow: 0, toCol: 2 });
    expect(merged?.cells['0:0']).toEqual({ colSpan: 3, text: { type: 'doc', content: [...(text('a').content ?? []), ...(text('b').content ?? [])] } });
    expect(merged?.cells['0:1']).toBeUndefined();
    const split = merged === undefined ? undefined : splitCell(merged, 0, 0);
    expect(split?.cells['0:0']).toEqual({ text: merged?.cells['0:0']?.text });
    // one cell, outside the grid, or cutting a merged cell: refused; a cell that is not merged does not split
    expect(mergeCells(grid, { row: 2, col: 2, toRow: 2, toCol: 2 })).toBeUndefined();
    expect(mergeCells(grid, { row: 0, col: 0, toRow: 3, toCol: 0 })).toBeUndefined();
    expect(mergeCells(grid, { row: 0, col: 2, toRow: 1, toCol: 2 })).toBeUndefined();
    expect(splitCell(grid, 2, 2)).toBeUndefined();
    expect(splitCell(grid, 1, 1)).toBeUndefined();
    // the first cell's style is kept, and no text stays none
    const plain = mergeCells({ rows: [{ h: 1 }], cols: [{ w: 1 }, { w: 1 }], cells: { '0:0': { style: { fill: 'red' } } } } as TableGrid, {
      row: 0,
      col: 0,
      toRow: 0,
      toCol: 1,
    });
    expect(plain?.cells['0:0']).toEqual({ style: { fill: 'red' }, colSpan: 2 });
  });

  it('FR-SHP-014: Tab steps through the cells in reading order, skipping the cells a merged cell covers', () => {
    const order: string[] = [];
    for (let at: { row: number; col: number } | undefined = { row: 0, col: 0 }; at !== undefined; at = stepCell(grid, at.row, at.col, 1))
      order.push(`${at.row}:${at.col}`);
    expect(order).toEqual(['0:0', '0:1', '1:0', '1:1', '1:2', '2:1', '2:2']);
    expect(stepCell(grid, 1, 0, -1)).toEqual({ row: 0, col: 1 });
    expect(stepCell(grid, 0, 0, -1)).toBeUndefined();
  });
});
