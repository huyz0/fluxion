import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('the freehand tool', { tag: '@desktop' }, () => {
  test('FR-EDT-003: a freehand drag adds exactly one stroke along it, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const screen = await editor.screenBox();
    const point = (fx: number, fy: number) => ({ x: Math.round(screen.x + screen.width * fx), y: Math.round(screen.y + screen.height * fy) });
    await editor.toolButton('Freehand').click();
    const from = point(0.2, 0.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (const [fx, fy] of [
      [0.3, 0.3],
      [0.4, 0.6],
      [0.5, 0.4],
    ] as const) {
      const p = point(fx, fy);
      await page.mouse.move(p.x, p.y, { steps: 4 });
    }
    await expect(page.locator('polyline.fx-chrome-sketch')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('polyline.fx-chrome-sketch')).toHaveCount(0);
    await expect(editor.elements).toHaveCount(1);
    await expect(editor.shapes).toHaveCount(1);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    // its box spans the stroke: from its start to its rightmost point
    const drawn = await editor.elements.first().boundingBox();
    expect(drawn?.x ?? 0).toBeCloseTo(from.x, -1);
    expect((drawn?.x ?? 0) + (drawn?.width ?? 0)).toBeCloseTo(point(0.5, 0.4).x, -1);
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.elements).toHaveCount(1);
  });
});
