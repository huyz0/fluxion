import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's rounded rectangle: 180 x 110 at (340, 60), corner radius 12 until set. */
const ROUNDED = 'nxDRZuw2s0ndrenl';

// a mouse drag on a handle: desktop input
test.describe('parametric handles', { tag: '@desktop' }, () => {
  test('FR-SHP-003: dragging the corner-radius handle changes params.radius, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    const at = (x: number, y: number) => ({ x: screen.x + x * scale, y: screen.y + y * scale });
    const shape = editor.element(ROUNDED);
    const radius = editor.panel('Inspector').getByLabel('r', { exact: true });
    const outline = () => shape.locator('path.fx-outline').getAttribute('d');
    const before = await outline();
    await page.mouse.click(at(430, 115).x, at(430, 115).y);
    await expect(radius).toHaveValue('12');
    // the handle sits on the top edge, one radius in from the left corner: (352, 60)
    const handle = editor.canvas.locator('[data-param-handle="r"]');
    await expect(handle).toHaveCount(1);
    const from = at(352, 60);
    const to = at(380, 60);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    // 40 px in from the corner: the radius is 40 (within a pixel of pointer error)
    await expect.poll(async () => Number(await radius.inputValue())).toBeGreaterThan(36);
    expect(Number(await radius.inputValue())).toBeLessThan(44);
    expect(await outline()).not.toBe(before);
    // the shape stays selected and the handle moved with the radius
    const moved = await handle.boundingBox();
    expect((moved?.x ?? 0) + (moved?.width ?? 0) / 2).toBeCloseTo(to.x, -1);
    // one undo puts the whole drag back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(radius).toHaveValue('12');
    expect(await outline()).toBe(before);
  });

  test('FR-SHP-003: a param typed in the inspector applies to the selected shape and is one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    await page.mouse.click(screen.x + 430 * scale, screen.y + 115 * scale);
    const radius = editor.panel('Inspector').getByLabel('r', { exact: true });
    await radius.fill('30');
    await radius.press('Enter');
    await expect(radius).toHaveValue('30');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(radius).toHaveValue('12');
  });
});
