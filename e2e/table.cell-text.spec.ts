import type { Locator, Page } from '@playwright/test';
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

// a double-click and the table menu: desktop input
test.describe('table cell text', { tag: '@desktop' }, () => {
  test('FR-SHP-014: a double-clicked cell is edited in place; Tab commits it and opens the next, skipping covered cells; each cell one Ctrl+Z (M19.43)', async ({
    page,
    expectAccessible,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Insert table');
    await page.keyboard.press('Enter');
    const table = editor.canvas.locator('.fx-el[data-kind="table"]');
    const cell = (key: string) => table.locator(`.fx-table-cell[data-cell="${key}"]`);
    const open = editor.canvas.getByTestId('cell-editor');
    // the second row's last two cells merged: Tab from 1:0 opens 1:1, then 2:0
    const at11 = await middle(cell('1:1'));
    await page.mouse.click(at11.x, at11.y);
    await page.keyboard.down('Shift');
    const at12 = await middle(cell('1:2'));
    await page.mouse.click(at12.x, at12.y);
    await page.keyboard.up('Shift');
    await fromMenu(page, cell('1:1'), 'Merge cells');
    await expect(table.locator('.fx-table-cell')).toHaveCount(8);
    // a double-click opens the cell there, in place over it
    const at00 = await middle(cell('0:0'));
    await page.mouse.dblclick(at00.x, at00.y);
    await expect(open.getByRole('textbox', { name: 'Cell text, row 1, column 1' })).toBeFocused();
    // laid over the cell it edits, the same box (the text inside it, the cell's padding in)
    const over = (await open.locator('.fx-label').first().boundingBox()) as Box;
    const under = (await cell('0:0').boundingBox()) as Box;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(over[k] - under[k])).toBeLessThan(1);
    await expectAccessible();
    await page.keyboard.type('Name');
    await page.keyboard.press('Tab');
    await expect(open.getByRole('textbox', { name: 'Cell text, row 1, column 2' })).toBeFocused();
    await expect(cell('0:0')).toHaveText('Name');
    await page.keyboard.type('Role');
    // Shift+Tab goes back, and nothing typed there writes nothing
    await page.keyboard.press('Shift+Tab');
    await expect(open.getByRole('textbox', { name: 'Cell text, row 1, column 1' })).toBeFocused();
    await expect(cell('0:1')).toHaveText('Role');
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    // Enter edits the picked cell; Tab skips the cell the merged one covers
    const at10 = await middle(cell('1:0'));
    await page.mouse.click(at10.x, at10.y);
    await page.keyboard.press('Enter');
    await expect(open.getByRole('textbox', { name: 'Cell text, row 2, column 1' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(open.getByRole('textbox', { name: 'Cell text, row 2, column 2' })).toBeFocused();
    await page.keyboard.type('Merged');
    await page.keyboard.press('Tab');
    await expect(open.getByRole('textbox', { name: 'Cell text, row 3, column 1' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(cell('1:1')).toHaveText('Merged');
    // each committed cell is one undo step, the last first
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cell('1:1')).toHaveText('');
    await expect(cell('0:1')).toHaveText('Role');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cell('0:1')).toHaveText('');
    await expect(cell('0:0')).toHaveText('Name');
  });
});
