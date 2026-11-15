import type { Locator, Page } from '@playwright/test';
import { drag } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

const middle = async (l: Locator) => {
  const b = (await l.boundingBox()) as Box;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Right-click `cell` and pick `item` from the table menu. */
async function fromMenu(page: Page, cell: Locator, item: string): Promise<void> {
  const at = await middle(cell);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// the pointer and the context menu: desktop input
test.describe('table editing', { tag: '@desktop' }, () => {
  test('FR-SHP-014: insert a table, then insert and delete rows and columns, merge, split and resize, each one Ctrl+Z; Tab moves the cell', async ({
    page,
    expectAccessible,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // Insert table from the command palette: a 3 × 3 table, selected, its first cell picked
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Insert table');
    await page.keyboard.press('Enter');
    const table = editor.canvas.locator('.fx-el[data-kind="table"]');
    await expect(table).toHaveCount(1);
    const cells = table.locator('.fx-table-cell');
    const cell = (key: string) => table.locator(`.fx-table-cell[data-cell="${key}"]`);
    const picked = editor.canvas.locator('[data-table-cells]');
    await expect(cells).toHaveCount(9);
    await expect(picked).toHaveCount(1);
    await expectAccessible();
    // a click picks the middle cell
    const at11 = await middle(cell('1:1'));
    await page.mouse.click(at11.x, at11.y);
    // each row and column operation, then one Ctrl+Z back to the 3 × 3 grid
    for (const [item, count] of [
      ['Insert row above', 12],
      ['Insert row below', 12],
      ['Insert column left', 12],
      ['Insert column right', 12],
      ['Delete row', 6],
      ['Delete column', 6],
    ] as const) {
      await fromMenu(page, cell('1:1'), item);
      await expect(cells).toHaveCount(count);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(cells).toHaveCount(9);
      await page.mouse.click(at11.x, at11.y);
    }
    // shift-click stretches the range to the corner; merged, the four cells are one; split, four again
    const at22 = await middle(cell('2:2'));
    await page.mouse.click(at11.x, at11.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(at22.x, at22.y);
    await page.keyboard.up('Shift');
    await fromMenu(page, cell('1:1'), 'Merge cells');
    await expect(cells).toHaveCount(6);
    await fromMenu(page, cell('1:1'), 'Split cell');
    await expect(cells).toHaveCount(9);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cells).toHaveCount(6);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cells).toHaveCount(9);
    // Tab moves the picked cell to the next in reading order
    await page.mouse.click(at11.x, at11.y);
    const before = (await picked.boundingBox()) as Box;
    await page.keyboard.press('Tab');
    await expect.poll(async () => ((await picked.boundingBox()) as Box).x).toBeGreaterThan(before.x + before.width / 2);
    // the border between the first two columns, dragged right, widens the first; one Ctrl+Z puts it back
    const first = (await cell('0:0').boundingBox()) as Box;
    const border = { x: first.x + first.width, y: first.y + first.height / 2 };
    await drag(page, border, { x: border.x + 40, y: border.y });
    await expect.poll(async () => ((await cell('0:0').boundingBox()) as Box).width).toBeGreaterThan(first.width + 30);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => ((await cell('0:0').boundingBox()) as Box).width).toBeCloseTo(first.width, 0);
  });
});
