import type { Page } from '@playwright/test';
import { drag, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

/** A new document with two shapes, the first (left) locked from the Layers tab. */
async function lockedPair(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.open('new');
  await shapeAt(page, editor, 0.1, 1);
  await shapeAt(page, editor, 0.5, 2);
  const panel = editor.panel('Screens, library and layers');
  await panel.getByRole('tab', { name: 'Layers' }).click();
  // front first: the first shape is the last row
  await panel
    .locator('.fx-chrome-layer')
    .last()
    .getByRole('button', { name: /^Lock / })
    .click();
  await expect(panel.locator('.fx-chrome-layer').last()).toHaveAttribute('data-locked', 'true');
  return editor;
}

const boxOf = async (editor: EditorPage, i: number): Promise<Box> => (await editor.shapes.nth(i).boundingBox()) as Box;

// the pointer and the keys: desktop input
test.describe('locks', { tag: '@desktop' }, () => {
  test('FR-SHP-008: a locked shape is not picked or dragged on the canvas, nor nudged or aligned; the unlocked one is', async ({ page, expectAccessible }) => {
    const editor = await lockedPair(page);
    const before = await boxOf(editor, 0);
    // a drag starting on the locked shape is a marquee, not a move
    await drag(page, await onScreen(editor, 0.16, 0.4), await onScreen(editor, 0.3, 0.6));
    expect(await boxOf(editor, 0)).toEqual(before);
    // picked from the Layers tab with the other one, then nudged and aligned: only the other one moves
    const rows = editor.panel('Screens, library and layers').locator('.fx-chrome-layer-button');
    await rows.last().click();
    await rows.first().click({ modifiers: ['Shift'] });
    const other = await boxOf(editor, 1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await boxOf(editor, 1)).y).toBeGreaterThan(other.y);
    expect(await boxOf(editor, 0)).toEqual(before);
    const on = await onScreen(editor, 0.56, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Align left' }).click();
    await expect.poll(async () => Math.round((await boxOf(editor, 1)).x)).toBe(Math.round(before.x));
    expect(await boxOf(editor, 0)).toEqual(before);
    await expectAccessible();
  });
});
