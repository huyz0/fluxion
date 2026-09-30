import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// mouse clicks: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('the pen tool', { tag: '@desktop' }, () => {
  test('FR-EDT-003: pen clicks and Enter add exactly one path through the vertices, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const screen = await editor.screenBox();
    const point = (fx: number, fy: number) => ({ x: Math.round(screen.x + screen.width * fx), y: Math.round(screen.y + screen.height * fy) });
    await page.keyboard.press('p');
    await expect(editor.toolButton('Pen')).toHaveAttribute('aria-pressed', 'true');
    for (const [fx, fy] of [
      [0.2, 0.6],
      [0.4, 0.3],
      [0.6, 0.6],
    ] as const) {
      const p = point(fx, fy);
      await page.mouse.click(p.x, p.y);
    }
    await expect(page.locator('polyline.fx-chrome-sketch')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('polyline.fx-chrome-sketch')).toHaveCount(0);
    await expect(editor.elements).toHaveCount(1);
    await expect(editor.shapes).toHaveCount(1);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
    // drawn as an open path through its vertices: its box spans them
    const drawn = await editor.elements.first().boundingBox();
    const [left, right] = [point(0.2, 0.6), point(0.6, 0.6)];
    expect(drawn?.x ?? 0).toBeCloseTo(left.x, -1);
    expect((drawn?.x ?? 0) + (drawn?.width ?? 0)).toBeCloseTo(right.x, -1);
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(0);
  });
});
