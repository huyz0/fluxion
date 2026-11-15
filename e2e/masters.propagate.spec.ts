import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

const NAV = 'Screens, library and layers';

/** Right-click `row` and pick `item` from its menu. */
async function fromMenu(page: Page, row: Locator, item: string): Promise<void> {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// the navigator's context menu and the pointer: desktop input
test.describe('master screens', { tag: '@desktop' }, () => {
  test('FR-SCR-005: a logo on a master shows on the three screens using it, and an edit to it shows on all three', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const nav = editor.panel(NAV);
    const add = nav.getByRole('button', { name: 'New screen', exact: true });
    for (let i = 0; i < 3; i++) await add.click();
    const screens = nav.getByRole('list', { name: 'Screens', exact: true }).locator('.fx-chrome-screen');
    await expect(screens).toHaveCount(4);
    // the first screen made a master: listed apart, and the other three use it
    await fromMenu(page, screens.first(), 'Make master');
    const masters = nav.getByRole('list', { name: 'Masters', exact: true }).locator('.fx-chrome-screen');
    await expect(masters).toHaveCount(1);
    await expect(screens).toHaveCount(3);
    for (let i = 0; i < 3; i++) await fromMenu(page, screens.nth(i), 'Use master: Screen 1');
    // a logo drawn on the master
    await masters.first().click();
    await editor.toolButton('Shape').click();
    const box = await editor.screenBox();
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await expect(editor.shapes).toHaveCount(1);
    const logo = (await editor.shapes.first().getAttribute('data-el-id')) as string;
    // each screen using the master draws the logo behind its own elements, in its thumbnail and on the canvas
    const shown = (row: Locator) => row.locator(`.fx-master .fx-el[data-el-id="${logo}"]`);
    for (let i = 0; i < 3; i++) await expect(shown(screens.nth(i))).toHaveCount(1);
    await screens.nth(1).click();
    await expect(editor.canvas.locator(`.fx-master .fx-el[data-el-id="${logo}"]`)).toHaveCount(1);
    await expectAccessible();
    // the logo moved on the master: every screen using it shows it moved
    await masters.first().click();
    await editor.toolButton('Select').click();
    const before = await shown(screens.nth(0)).getAttribute('style');
    const at = (await editor.shapes.first().boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await page.keyboard.press('Shift+ArrowRight');
    const moved = await editor.shapes.first().getAttribute('style');
    expect(moved).not.toBe(before);
    for (let i = 0; i < 3; i++) await expect(shown(screens.nth(i))).toHaveAttribute('style', moved as string);
    // the logo made a placeholder: a screen using the master shows a hint there, and a double-click fills it with its own copy
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Make placeholder', exact: true }).click();
    await screens.nth(0).click();
    const hint = editor.canvas.locator('.fx-master-placeholder');
    await expect(hint).toHaveCount(1);
    const spot = (await hint.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.dblclick(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await expect(hint).toHaveCount(0);
    // the screen's own shape, not the master's
    const own = () => editor.shapes.evaluateAll((els) => els.filter((e) => e.closest('.fx-master') === null).length);
    await expect.poll(own).toBe(1);
    await expectAccessible();
  });
});
