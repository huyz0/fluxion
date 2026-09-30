import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** Page coordinates of the gallery screen (1920 wide) as a client point, through the fitted canvas. */
async function client(editor: EditorPage, x: number, y: number): Promise<{ x: number; y: number }> {
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  return { x: screen.x + x * scale, y: screen.y + y * scale };
}

/** Drag the mouse between two page points of the gallery screen. */
async function drag(page: Page, editor: EditorPage, from: readonly [number, number], to: readonly [number, number]): Promise<void> {
  const a = await client(editor, from[0], from[1]);
  const b = await client(editor, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

// mouse drags: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('marquee selection', { tag: '@desktop' }, () => {
  test('FR-EDT-004: a marquee dragged rightwards selects what it contains', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    // around the first row's rectangle and rounded rectangle (x 80-520, y 60-170), short of the ellipse
    await drag(page, editor, [60, 40], [540, 190]);
    await expect(editor.inspectorText).toHaveText('2 elements selected');
  });

  test('FR-EDT-004: a marquee dragged leftwards selects what it touches', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    // from the empty gap below the first row's ellipse, up and back to its rectangle: the band touches
    // the rectangle, rounded rectangle and ellipse (y 60-170) but contains none of them
    await drag(page, editor, [700, 200], [200, 100]);
    await expect(editor.inspectorText).toHaveText('3 elements selected');
  });

  test('FR-EDT-004: shift adds a marquee to the selection; ctrl/cmd + A selects every element; a click clears', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await drag(page, editor, [60, 40], [540, 190]);
    await page.keyboard.down('Shift');
    // around the second row's hexagon (x 80-260, y 230-340)
    await drag(page, editor, [60, 210], [280, 360]);
    await page.keyboard.up('Shift');
    await expect(editor.inspectorText).toHaveText('3 elements selected');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor.inspectorText).toHaveText('31 elements selected');
    const below = await client(editor, 960, 1100);
    await page.mouse.click(below.x, below.y);
    await expect(editor.inspectorText).toHaveText('Select an element to see its properties.');
  });
});
