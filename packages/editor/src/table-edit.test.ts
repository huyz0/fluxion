import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId, TableElement } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { menuItems } from './context-menu-model.js';
import { commandMap, dispatchKey, EDITOR_COMMANDS } from './editor-commands.js';
import { DEFAULT_KEYMAP, type KeyPress } from './keymap.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { editCellAt, editPickedCell, openCell, pickForMenu } from './table-edit.js';
import { createToolDispatcher, createToolRegistry, type ToolCtx } from './tools.js';

/** A 3 × 3 table of 300 × 90 at (100, 100) (cells 100 × 30), with the select tool over it. */
function setup() {
  const b = documentBuilder({ seed: 1921 });
  const s = b.screen({ size: { w: 1000, h: 1000 } });
  const id = b.rect(s, { x: 100, y: 100, w: 300, h: 90 });
  const rect = b.rect(s, { x: 600, y: 600, w: 50, h: 50 });
  const file = b.build();
  const { defId: _defId, ...base } = file.records[id] as unknown as Record<string, unknown>;
  const grid = { rows: [{ h: 1 }, { h: 1 }, { h: 1 }], cols: [{ w: 1 }, { w: 1 }, { w: 1 }], cells: {}, tableStyle: 'grid' };
  const core = createCore({ ...file, records: { ...file.records, [id]: { ...base, kind: 'table', ...grid } } } as unknown as DocumentFile);
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx: ToolCtx = {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => 'newnewnewnew0001' as RecordId,
    hitTest: (p) => (p.x >= 100 && p.x <= 400 && p.y >= 100 && p.y <= 190 ? id : p.x >= 600 ? rect : undefined),
    elementsIn: () => [],
    screen: s,
    allElements: () => [],
  };
  const tools = createToolDispatcher(registry, ctx);
  const table = () => core.store.get(id) as unknown as TableElement;
  const run = (command: string) => commandMap().get(command)?.run({ mode: 'edit', tools }) === true;
  const key = (k: string, shift = false) =>
    dispatchKey({ key: k, shift, alt: false, mod: false } as KeyPress, DEFAULT_KEYMAP, commandMap(), { mode: 'edit', tools });
  return { core, id, rect, session, ctx, tools, table, run, key };
}

const at = (phase: PointerPhase, x: number, y: number, shift = false): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
});

const click = (t: ReturnType<typeof setup>, x: number, y: number, shift = false) => {
  t.tools.pointer(at('down', x, y, shift));
  t.tools.pointer(at('up', x, y, shift));
};

describe('table editing in the editor (FR-SHP-014, ADR-0054)', () => {
  it('FR-SHP-014: a click on the selected table picks the cell under it, shift-click stretches the range, and the first click only selects', () => {
    const t = setup();
    click(t, 150, 115);
    expect(t.session.selection.get()).toEqual([t.id]);
    expect(t.session.tableCells.get()).toBeUndefined();
    click(t, 150, 115);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 0, col: 0, toRow: 0, toCol: 0 });
    click(t, 250, 175, true);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 0, col: 0, toRow: 2, toCol: 1 });
    expect(t.session.selection.get()).toEqual([t.id]);
    // another selection drops the picked cells
    t.session.selection.set([]);
    expect(t.session.tableCells.get()).toBeUndefined();
  });

  it('FR-SHP-014: the table commands insert, delete, merge and split beside the picked cells, each one undo step', () => {
    const t = setup();
    t.session.selection.set([t.id]);
    expect(t.run('table.insertRowBelow')).toBe(false);
    click(t, 250, 145);
    expect(t.run('table.insertRowBelow')).toBe(true);
    expect(t.table().rows).toHaveLength(4);
    expect(t.session.tableCells.get()).toMatchObject({ row: 1, col: 1 });
    t.core.store.history.undo();
    expect(t.table().rows).toHaveLength(3);
    expect(t.run('table.insertColumnLeft')).toBe(true);
    expect(t.table().cols).toHaveLength(4);
    // the picked cell moves with the column inserted before it
    expect(t.session.tableCells.get()).toMatchObject({ col: 2, toCol: 2 });
    expect(t.run('table.deleteColumn')).toBe(true);
    expect(t.table().cols).toHaveLength(3);
    expect(t.session.tableCells.get()).toMatchObject({ row: 1, col: 2, toRow: 1, toCol: 2 });
    click(t, 250, 145);
    click(t, 350, 175, true);
    expect(t.run('table.merge')).toBe(true);
    expect(t.table().cells['1:1']).toEqual({ rowSpan: 2, colSpan: 2 });
    expect(t.run('table.split')).toBe(true);
    expect(t.table().cells['1:1']).toEqual({});
    t.core.store.history.undo();
    expect(t.table().cells['1:1']).toEqual({ rowSpan: 2, colSpan: 2 });
    // locked against editing, the grid stays as it is
    t.core.execute('element.update', { id: t.id, fields: { locks: { edit: true } } });
    expect(t.run('table.deleteRow')).toBe(false);
    expect(t.table().rows).toHaveLength(3);
  });

  it('FR-SHP-014: Tab and Shift+Tab move the picked cell in reading order; with none picked Tab is left to the focus', () => {
    const t = setup();
    t.session.selection.set([t.id]);
    expect(t.key('Tab')).toBe(false);
    click(t, 350, 115);
    expect(t.key('Tab')).toBe(true);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 1, col: 0, toRow: 1, toCol: 0 });
    expect(t.key('Tab', true)).toBe(true);
    expect(t.session.tableCells.get()).toMatchObject({ row: 0, col: 2 });
  });

  it("FR-SHP-014: dragging a border shares the two lines' space anew in one undo step, and Esc puts it back", () => {
    const t = setup();
    t.session.selection.set([t.id]);
    t.tools.pointer(at('down', 201, 150));
    expect(t.tools.current).toBe('select.tableResizing');
    t.tools.pointer(at('move', 220, 150));
    t.tools.pointer(at('move', 230, 150));
    t.tools.pointer(at('up', 230, 150));
    expect(t.table().cols.map((c) => c.w)).toEqual([1.3, 0.7, 1].map((w) => expect.closeTo(w, 9)));
    t.core.store.history.undo();
    expect(t.table().cols.map((c) => c.w)).toEqual([1, 1, 1]);
    // a row border, dragged past the next one, stops short of it; Esc restores
    t.tools.pointer(at('down', 250, 160));
    t.tools.pointer(at('move', 250, 500));
    expect(t.table().rows.map((r) => r.h * 30)).toEqual([30, 30 + 30 - 8, 8].map((h) => expect.closeTo(h, 9)));
    t.tools.cancel();
    expect(t.table().rows.map((r) => r.h)).toEqual([1, 1, 1]);
    // locked against editing, a border press is no resize
    t.core.execute('element.update', { id: t.id, fields: { locks: { edit: true } } });
    t.tools.pointer(at('down', 201, 150));
    expect(t.tools.current).not.toBe('select.tableResizing');
  });

  it('FR-SHP-014: in a larger selection a click on the table narrows to it and shift-click takes it out, as on any element', () => {
    const t = setup();
    t.session.selection.set([t.id, t.rect]);
    click(t, 150, 115);
    expect(t.session.selection.get()).toEqual([t.id]);
    expect(t.session.tableCells.get()).toBeUndefined();
    t.session.selection.set([t.id, t.rect]);
    click(t, 150, 115, true);
    expect(t.session.selection.get()).toEqual([t.rect]);
  });

  it('FR-SHP-014: a frame handle where an inner border meets the edge stays the handle', () => {
    const t = setup();
    // four columns: the middle border meets the top and bottom edges at the n and s handles
    t.core.execute('element.update', { id: t.id, fields: { cols: [{ w: 1 }, { w: 1 }, { w: 1 }, { w: 1 }] } });
    t.session.selection.set([t.id]);
    t.tools.pointer(at('down', 250, 101));
    expect(t.tools.current).toBe('select.resizing');
    t.tools.pointer(at('up', 250, 101));
    t.tools.pointer(at('down', 250, 145));
    expect(t.tools.current).toBe('select.tableResizing');
  });

  it('FR-SHP-014: an undo that takes lines away leaves the picked cell inside the grid', () => {
    const t = setup();
    t.session.selection.set([t.id]);
    click(t, 350, 115);
    expect(t.run('table.insertColumnLeft')).toBe(true);
    expect(t.session.tableCells.get()).toMatchObject({ col: 3 });
    t.core.store.history.undo();
    // the pick reads as the last column: Tab goes on to the next row's first cell
    expect(t.key('Tab')).toBe(true);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 1, col: 0, toRow: 1, toCol: 0 });
    click(t, 350, 115);
    expect(t.run('table.insertColumnLeft')).toBe(true);
    t.core.store.history.undo();
    expect(t.run('table.deleteColumn')).toBe(true);
    expect(t.table().cols).toHaveLength(2);
  });

  it('FR-SHP-014: the table menu leads with the row, column and cell lines, and picks the right-clicked cell', () => {
    const t = setup();
    t.session.selection.set([t.id]);
    expect(pickForMenu(t.ctx, t.id, { x: 350, y: 175 })).toBe(true);
    expect(t.session.tableCells.get()).toMatchObject({ row: 2, col: 2 });
    // a cell inside the picked range keeps the range
    click(t, 150, 115);
    click(t, 350, 175, true);
    pickForMenu(t.ctx, t.id, { x: 250, y: 145 });
    expect(t.session.tableCells.get()).toMatchObject({ row: 0, col: 0, toRow: 2, toCol: 2 });
    expect(pickForMenu(t.ctx, 'nope' as RecordId, { x: 0, y: 0 })).toBe(false);
    expect(
      menuItems('table', EDITOR_COMMANDS)
        .slice(0, 9)
        .map((i) => i.title),
    ).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      'Delete row',
      'Delete column',
      'Merge cells',
      'Split cell',
      'Cut',
    ]);
  });

  it('FR-SHP-014: Insert table adds a selected 3 × 3 grid table at the middle of the screen, its first cell picked', () => {
    const t = setup();
    expect(t.run('table.insert')).toBe(true);
    const [id] = t.session.selection.get();
    const made = t.core.store.get(id as RecordId) as unknown as TableElement;
    expect(made).toMatchObject({ kind: 'table', tableStyle: 'grid', transform: { x: 320, y: 440, w: 360, h: 120 } });
    expect(made.rows).toHaveLength(3);
    expect(t.session.tableCells.get()).toEqual({ id, row: 0, col: 0, toRow: 0, toCol: 0 });
    t.core.store.history.undo();
    expect(t.core.store.get(id as RecordId)).toBeUndefined();
  });
  it('FR-SHP-014: each row and column line beside the picked cell lands where it says, the picked cell moving with its own (cp4 F6)', () => {
    const t = setup();
    t.session.selection.set([t.id]);
    // the middle cell holds text, so each case can tell which line moved
    const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
    expect(t.core.execute('element.update', { id: t.id, fields: { cells: { '1:1': { text } } } }).ok).toBe(true);
    t.core.store.history.seal();
    const keys = () => Object.keys(t.table().cells);
    click(t, 250, 145);
    expect(t.run('table.insertRowAbove')).toBe(true);
    // the new row goes before row 1, so the text and the picked cell move down to row 2
    expect([t.table().rows.length, keys()]).toEqual([4, ['2:1']]);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 2, col: 1, toRow: 2, toCol: 1 });
    t.core.store.history.undo();
    click(t, 250, 145);
    expect(t.run('table.insertColumnRight')).toBe(true);
    // the new column goes after column 1: the text and the picked cell stay at 1:1
    expect([t.table().cols.length, keys()]).toEqual([4, ['1:1']]);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 1, col: 1, toRow: 1, toCol: 1 });
    t.core.store.history.undo();
    click(t, 250, 115);
    expect(t.run('table.deleteRow')).toBe(true);
    // row 0 goes: the text moves up to row 0 and the picked cell stays on the row that took the deleted one's place
    expect([t.table().rows.length, keys()]).toEqual([2, ['0:1']]);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 0, col: 1, toRow: 0, toCol: 1 });
    t.core.store.history.undo();
    click(t, 350, 145);
    expect(t.run('table.deleteColumn')).toBe(true);
    // column 2 goes: the text keeps its place, and the picked cell steps back inside the grid
    expect([t.table().cols.length, keys()]).toEqual([2, ['1:1']]);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 1, col: 1, toRow: 1, toCol: 1 });
  });

  it("FR-SHP-014: a double-click on a cell, or Enter with one picked, opens that cell's text; a covered cell or a locked table opens none (M19.43)", () => {
    const t = setup();
    // a double-click on an unselected table selects it and opens the cell there, picked
    expect(editCellAt(t.session, t.core.store, t.id, { x: 250, y: 145 })).toBe(true);
    expect(t.session.selection.get()).toEqual([t.id]);
    expect(t.session.tableCells.get()).toEqual({ id: t.id, row: 1, col: 1, toRow: 1, toCol: 1 });
    expect(t.session.editingCell.get()).toEqual({ id: t.id, row: 1, col: 1 });
    expect(editCellAt(t.session, t.core.store, t.id, { x: 50, y: 50 })).toBe(false);
    expect(editCellAt(t.session, t.core.store, t.rect, { x: 620, y: 620 })).toBe(false);
    // another selection closes it
    t.session.selection.set([t.rect]);
    expect(t.session.editingCell.get()).toBeUndefined();
    // Enter with a range picked across a merged cell opens the merged cell's own
    t.core.execute('element.update', { id: t.id, fields: { cells: { '0:0': { rowSpan: 2, colSpan: 2 } } } });
    t.session.selection.set([t.id]);
    expect(editPickedCell(t.session, t.core.store)).toBe(false);
    t.session.tableCells.set({ id: t.id, row: 1, col: 1, toRow: 1, toCol: 2 });
    expect(t.key('enter')).toBe(true);
    expect(t.session.editingCell.get()).toEqual({ id: t.id, row: 0, col: 0 });
    // a cell a merged one covers is no cell of its own
    t.session.editingCell.set(undefined);
    expect(openCell(t.session, t.core.store, { id: t.id, row: 1, col: 1 })).toBe(false);
    expect(t.session.editingCell.get()).toBeUndefined();
    // locked against editing, no cell opens
    t.core.execute('element.update', { id: t.id, fields: { locks: { edit: true } } });
    expect(openCell(t.session, t.core.store, { id: t.id, row: 2, col: 2 })).toBe(false);
    expect(editCellAt(t.session, t.core.store, t.id, { x: 350, y: 175 })).toBe(false);
  });
});
