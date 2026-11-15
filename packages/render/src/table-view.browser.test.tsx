import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId, RichTextDoc, TableCell } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { LIGHT_THEME } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinRegistries } from './builtins.js';
import { ScreenView } from './screen-view.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const text = (s: string): RichTextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] });

type TableFields = {
  readonly rows: readonly { h: number }[];
  readonly cols: readonly { w: number }[];
  readonly cells: { readonly [key: string]: TableCell };
  readonly tableStyle?: string;
};

/** A 300 × 120 table of `fields` at (50, 50), the document themed by `theme` when given; the table's drawn cells by key. */
async function show(fields: TableFields, theme?: Record<string, unknown>) {
  const b = documentBuilder({ seed: 1920 });
  const screenId = b.screen({ size: { w: 400, h: 400 } });
  const id = b.rect(screenId, { x: 50, y: 50, w: 300, h: 120 });
  const file = b.build();
  const { defId: _defId, ...base } = file.records[id] as unknown as Record<string, unknown>;
  const records: Record<string, unknown> = { ...file.records, [id]: { ...base, kind: 'table', ...fields } };
  if (theme !== undefined) {
    const docId = Object.keys(records).find((k) => (records[k] as { type: string }).type === 'document') as string;
    records['theme-test'] = { id: 'theme-test', type: 'theme', name: 'test', tokens: LIGHT_THEME.tokens, ...theme };
    records[docId] = { ...(records[docId] as object), themeId: 'theme-test' };
  }
  const core = createCore({ ...file, records } as unknown as DocumentFile);
  const registries = builtinRegistries(core.registries.shapeDefs);
  await act(async () =>
    root.render(<ScreenView registries={registries} store={core.store} screenId={screenId} mode="present" view={{ kind: 'fit', box: { w: 400, h: 400 } }} />),
  );
  const table = host.querySelector(`.fx-el[data-el-id="${id as RecordId}"] .fx-table`) as HTMLElement;
  const cell = (key: string) => table.querySelector(`[data-cell="${key}"]`) as HTMLElement;
  return { table, cell, cells: () => [...table.querySelectorAll<HTMLElement>('.fx-table-cell')].map((c) => c.dataset['cell']) };
}

const css = (el: HTMLElement) => getComputedStyle(el);
const box = (el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

/** Three rows (a header and two body rows) of two columns, each cell named by its key. */
const twoByThree = (tableStyle: string): TableFields => ({
  rows: [{ h: 1 }, { h: 1 }, { h: 1 }],
  cols: [{ w: 1 }, { w: 1 }],
  cells: Object.fromEntries(['0:0', '0:1', '1:0', '1:1', '2:0', '2:1'].map((k) => [k, { text: text(`cell ${k}`) }])),
  tableStyle,
});

describe('the table view (FR-SHP-014, ADR-0054)', () => {
  it('FR-SHP-014: rows and columns share the box by weight; merged cells span theirs and the cells they cover are not drawn', async () => {
    const { cell, cells } = await show({
      rows: [{ h: 1 }, { h: 1 }, { h: 2 }],
      cols: [{ w: 1 }, { w: 2 }, { w: 1 }],
      cells: { '0:0': { colSpan: 2, text: text('wide') }, '1:2': { rowSpan: 2, text: text('tall') }, '2:0': { text: text('x') } },
    });
    // 0:1 is covered by 0:0's span and 2:2 by 1:2's; the other keys, held or not, are drawn
    expect(cells()).toEqual(['0:0', '0:2', '1:0', '1:1', '1:2', '2:0', '2:1']);
    expect(box(cell('0:0'))).toEqual({ x: 0, y: 0, w: 225, h: 30 });
    expect(box(cell('1:2'))).toEqual({ x: 225, y: 30, w: 75, h: 90 });
    expect(box(cell('2:1'))).toEqual({ x: 75, y: 60, w: 150, h: 60 });
    expect(cell('0:0').textContent).toBe('wide');
    expect(cell('1:1').textContent).toBe('');
  });

  it('FR-SHP-014: the built-in plain, banded and grid table styles draw to their goldens', async () => {
    for (const name of ['plain', 'banded', 'grid']) {
      const { table } = await show(twoByThree(name));
      await expect(table.outerHTML).toMatchFileSnapshot(`../__golden__/table/${name}.html`);
    }
    const plain = await show(twoByThree('plain'));
    expect(css(plain.cell('1:0')).outlineWidth).toBe('0px');
    expect(css(plain.cell('0:0').querySelector('.fx-label') as HTMLElement).fontWeight).toBe('700');
    const banded = await show(twoByThree('banded'));
    // the header in the primary colour, the second body row (row 2) in the surface colour, the first body row in the background
    expect(css(banded.cell('0:0')).backgroundColor).toBe('rgb(37, 99, 235)');
    expect(css(banded.cell('2:0')).backgroundColor).toBe('rgb(248, 250, 252)');
    expect(css(banded.cell('1:0')).backgroundColor).not.toBe(css(banded.cell('2:0')).backgroundColor);
    const grid = await show(twoByThree('grid'));
    expect(Number.parseFloat(css(grid.cell('1:1')).outlineWidth)).toBeGreaterThan(0);
  });

  it('FR-SHP-014: a cell’s opacity fades its fill, border and text together, once', async () => {
    const two = twoByThree('grid');
    const { cell } = await show({ ...two, cells: { ...two.cells, '1:1': { text: text('faded'), style: { opacity: 0.4 } } } });
    expect(css(cell('1:1')).opacity).toBe('0.4');
    expect(css(cell('1:1').querySelector('.fx-label') as HTMLElement).opacity).toBe('1');
    expect(css(cell('1:0')).opacity).toBe('1');
  });

  it('FR-SHP-014: a cell’s style wins over its table-style part, which wins over the theme; the theme’s own table style wins over the built-in', async () => {
    const theme = {
      defaults: { ...LIGHT_THEME.defaults, table: { fill: '#00ff00' } },
      tableStyles: { banded: { header: { fill: '#ff0000' } } },
    };
    const fields = twoByThree('banded');
    const { cell } = await show({ ...fields, cells: { ...fields.cells, '0:1': { text: text('own'), style: { fill: '#0000ff' } } } }, theme);
    // the theme's banded header replaces the built-in's; a cell style wins over it
    expect(css(cell('0:0')).backgroundColor).toBe('rgb(255, 0, 0)');
    expect(css(cell('0:1')).backgroundColor).toBe('rgb(0, 0, 255)');
    // the theme's banded names no band or cell part: body cells take the theme's table default
    expect(css(cell('2:0')).backgroundColor).toBe('rgb(0, 255, 0)');
    // no table style at all: the theme's defaults
    const { tableStyle: _style, ...unstyled } = fields;
    const bare = await show(unstyled, theme);
    expect(css(bare.cell('0:0')).backgroundColor).toBe('rgb(0, 255, 0)');
  });
});
