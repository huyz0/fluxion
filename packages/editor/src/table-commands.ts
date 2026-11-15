// The table commands (FR-SHP-014): insert a table; insert and delete rows and columns beside the picked cells; merge and split;
// Tab and Shift+Tab between cells. Each runs between gestures of the select tool, like the other selection commands
// (editor-commands.ts, which lists these).
import { deleteLines, insertBeside, insertTable, mergePicked, splitPicked, stepPicked } from './table-edit.js';
import type { ToolCtx } from './tools.js';

/**
 * The commands of the table menu, in its order.
 *
 * @public
 */
export const TABLE_MENU: readonly string[] = [
  'table.insertRowAbove',
  'table.insertRowBelow',
  'table.insertColumnLeft',
  'table.insertColumnRight',
  'table.deleteRow',
  'table.deleteColumn',
  'table.merge',
  'table.split',
];

/**
 * The table commands: id, title, and what each does to the tool context (run between gestures of the select tool).
 *
 * @public
 */
export const TABLE_ACTIONS: readonly (readonly [id: string, title: string, act: (ctx: ToolCtx) => boolean])[] = [
  ['table.insert', 'Insert table', insertTable],
  ['table.insertRowAbove', 'Insert row above', (c) => insertBeside(c, 'row', false)],
  ['table.insertRowBelow', 'Insert row below', (c) => insertBeside(c, 'row', true)],
  ['table.insertColumnLeft', 'Insert column left', (c) => insertBeside(c, 'col', false)],
  ['table.insertColumnRight', 'Insert column right', (c) => insertBeside(c, 'col', true)],
  ['table.deleteRow', 'Delete row', (c) => deleteLines(c, 'row')],
  ['table.deleteColumn', 'Delete column', (c) => deleteLines(c, 'col')],
  ['table.merge', 'Merge cells', mergePicked],
  ['table.split', 'Split cell', splitPicked],
  ['table.nextCell', 'Next cell', (c) => stepPicked(c, 1)],
  ['table.previousCell', 'Previous cell', (c) => stepPicked(c, -1)],
];
