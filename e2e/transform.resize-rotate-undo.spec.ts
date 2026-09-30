import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's first shape: a filled rectangle at x 80-260, y 60-170 on its 1920-wide screen. */
const RECT = 'SvJFIk0oCSKcTo6X';

async function onScreen(editor: EditorPage) {
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  return { scale, at: (x: number, y: number) => ({ x: screen.x + x * scale, y: screen.y + y * scale }) };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, key?: string): Promise<void> {
  await page.mouse.move(from.x, from.y);
  if (key) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

// mouse drags on handles: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('resizing and rotating', { tag: '@desktop' }, () => {
  test('FR-EDT-004: resize and rotate from the handles, and undo restores the box exactly', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const { scale, at } = await onScreen(editor);
    const shape = editor.element(RECT);
    const inside = at(170, 115);
    await page.mouse.click(inside.x, inside.y);
    const before = await shape.boundingBox();
    if (before === null) throw new Error('the rectangle is not drawn');
    // the se handle at the corner (260, 170): 100 wider, 50 taller
    await drag(page, at(260, 170), at(360, 220));
    const resized = await shape.boundingBox();
    expect(resized?.width).toBeCloseTo(before.width + 100 * scale, 0);
    expect(resized?.height).toBeCloseTo(before.height + 50 * scale, 0);
    // shift keeps the aspect: the se handle dragged right only grows both sides
    await drag(page, at(360, 220), at(460, 220), 'Shift');
    const kept = await shape.boundingBox();
    expect((kept?.width ?? 0) / (kept?.height ?? 1)).toBeCloseTo(280 / 160, 1);
    // the rotate handle, 24 px above the top edge's middle, swept a quarter turn with shift
    const box = await shape.boundingBox();
    if (box === null) throw new Error('the rectangle is not drawn');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await drag(page, { x: centre.x, y: box.y - 24 }, { x: centre.x + 300, y: centre.y + 3 }, 'Shift');
    await expect.poll(async () => (await shape.getAttribute('style')) ?? '').toContain('rotate(90deg)');
    // three gestures, three undo steps: the box as it was, exactly
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await shape.getAttribute('style')) ?? '').toContain('rotate(0deg)');
    expect(await shape.boundingBox()).toEqual(before);
    // and redo brings the last back
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(async () => (await shape.boundingBox())?.width ?? 0).toBeCloseTo(before.width + 100 * scale, 0);
  });
});
