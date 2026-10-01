import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's first three shapes (180 x 110 at y 60), left to right. */
const SHAPES = ['SvJFIk0oCSKcTo6X', 'nxDRZuw2s0ndrenl', 'deS3gED1EdXkXClU'];
const CENTRES = [170, 430, 690];

const fillOf = (editor: EditorPage, id: string) =>
  editor
    .element(id)
    .locator('path.fx-outline')
    .evaluate((p) => getComputedStyle(p).fill);

async function setFill(page: Page, editor: EditorPage, value: string): Promise<void> {
  const box = editor.panel('Inspector').getByLabel('Fill value');
  await box.click();
  await box.fill(value);
  await box.press('Enter');
}

// mouse and keyboard: desktop input
test.describe('the inspector', { tag: '@desktop' }, () => {
  test('FR-EDT-008: a mixed fill set on 3 shapes updates all 3 in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    const at = (x: number) => ({ x: screen.x + x * scale, y: screen.y + 115 * scale });
    // two shapes get their own fills, one at a time
    await page.mouse.click(at(CENTRES[0] as number).x, at(CENTRES[0] as number).y);
    await setFill(page, editor, '#ff0000');
    await page.mouse.click(at(CENTRES[1] as number).x, at(CENTRES[1] as number).y);
    await setFill(page, editor, '#0000ff');
    // all three selected: the fill differs, so the inspector says Mixed
    await page.mouse.click(at(CENTRES[0] as number).x, at(CENTRES[0] as number).y);
    await page.keyboard.down('Shift');
    for (const x of CENTRES.slice(1)) await page.mouse.click(at(x).x, at(x).y);
    await page.keyboard.up('Shift');
    await expect(editor.inspectorText).toHaveText('3 elements selected');
    const fill = editor.panel('Inspector').getByLabel('Fill value');
    await expect(fill).toHaveAttribute('placeholder', 'Mixed');
    await setFill(page, editor, '#00aa00');
    for (const id of SHAPES) await expect.poll(() => fillOf(editor, id)).toBe('rgb(0, 170, 0)');
    await expect(fill).toHaveValue('#00aa00');
    // one undo takes all three back
    await page.keyboard.press('Escape');
    await page.mouse.click(screen.x + 5, screen.y + screen.height - 5);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => fillOf(editor, SHAPES[0] as string)).toBe('rgb(255, 0, 0)');
    await expect.poll(() => fillOf(editor, SHAPES[1] as string)).toBe('rgb(0, 0, 255)');
    expect(await fillOf(editor, SHAPES[2] as string)).not.toBe('rgb(0, 170, 0)');
  });
});
