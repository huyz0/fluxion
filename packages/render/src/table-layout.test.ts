import { LIGHT_THEME } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { tableCellStyle, tableCells } from './table-layout.js';

describe('table layout (FR-SHP-014, ADR-0054)', () => {
  it('FR-SHP-014: a span reaching past the grid is cut at its edge, and a fractional span is read whole', () => {
    const cells = tableCells({ rows: [{ h: 1 }, { h: 1 }], cols: [{ w: 1 }, { w: 3 }], cells: { '0:1': { rowSpan: 5, colSpan: 1.7 } } }, { w: 100, h: 50 });
    expect(cells.map((c) => [c.key, c.rowSpan, c.colSpan, c.x, c.y, c.w, c.h])).toEqual([
      ['0:0', 1, 1, 0, 0, 25, 25],
      ['0:1', 2, 1, 25, 0, 75, 50],
      ['1:0', 1, 1, 0, 25, 25, 25],
    ]);
  });

  it('FR-SHP-014: the header part is row 0 and the band every second body row; an unknown table style takes the theme alone', () => {
    const table = { id: 't' as never, tableStyle: 'banded' };
    const fills = [0, 1, 2, 3, 4].map((row) => tableCellStyle(table, row, undefined, LIGHT_THEME).fill);
    expect(fills.map((f) => (f.type === 'color' ? f.css : f.type))).toEqual([
      'var(--fx-color-primary)',
      'var(--fx-color-background)',
      'var(--fx-color-surface)',
      'var(--fx-color-background)',
      'var(--fx-color-surface)',
    ]);
    expect(tableCellStyle({ ...table, tableStyle: 'nope' }, 0, undefined, LIGHT_THEME).fill.type).not.toBe('color');
  });
});
