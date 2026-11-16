import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's first three shapes (180 x 110 at y 60), left to right. */
const SHAPES = ['SvJFIk0oCSKcTo6X', 'nxDRZuw2s0ndrenl', 'deS3gED1EdXkXClU'] as const;
const CENTRES = [170, 430, 690] as const;
const RED = 'rgb(255, 0, 0)';

const fillOf = (editor: EditorPage, id: string) =>
  editor
    .element(id)
    .locator('path.fx-outline')
    .evaluate((p) => getComputedStyle(p).fill);

async function setFill(editor: EditorPage, value: string): Promise<void> {
  const box = editor.panel('Inspector').getByLabel('Fill value');
  await box.click();
  await box.fill(value);
  await box.press('Enter');
}

/** Client coordinates of the centre of shape `k` of the gallery. */
async function centre(editor: EditorPage, k: number): Promise<{ x: number; y: number }> {
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  return { x: screen.x + (CENTRES[k] as number) * scale, y: screen.y + 115 * scale };
}

const menuItem = (page: Page, name: string) => page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name });

// the context menu, the pointer and the palette: desktop input
test.describe('copy style and paste style', { tag: '@desktop' }, () => {
  test('FR-ARR-007: Copy style on one shape and Paste style on two others restyles both in one undo step; the palette pastes too', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const [first, second, third] = [await centre(editor, 0), await centre(editor, 1), await centre(editor, 2)];
    await page.mouse.click(first.x, first.y);
    await setFill(editor, '#ff0000');
    await page.mouse.click(first.x, first.y, { button: 'right' });
    await expect(menuItem(page, 'Paste style')).toHaveCount(0);
    await menuItem(page, 'Copy style').click();
    // two others selected: the menu of one of them pastes onto both
    await page.mouse.click(second.x, second.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(third.x, third.y);
    await page.keyboard.up('Shift');
    await page.mouse.click(second.x, second.y, { button: 'right' });
    await menuItem(page, 'Paste style').click();
    for (const id of SHAPES) await expect.poll(() => fillOf(editor, id)).toBe(RED);
    // one undo takes both back, and the source keeps its style
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => fillOf(editor, SHAPES[1])).not.toBe(RED);
    expect(await fillOf(editor, SHAPES[2])).not.toBe(RED);
    expect(await fillOf(editor, SHAPES[0])).toBe(RED);
    // the palette's Paste style onto one shape
    await page.mouse.click(third.x, third.y);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Paste style');
    await page.keyboard.press('Enter');
    await expect.poll(() => fillOf(editor, SHAPES[2])).toBe(RED);
    expect(await fillOf(editor, SHAPES[1])).not.toBe(RED);
  });
});
