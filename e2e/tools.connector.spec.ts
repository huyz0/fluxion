import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('the connector tool', { tag: '@desktop' }, () => {
  test('FR-EDT-003: a drag between two shapes adds exactly one connector bound to both, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // two rectangles, placed with the shape tool
    const screen = await editor.screenBox();
    const point = (fx: number, fy: number) => ({ x: Math.round(screen.x + screen.width * fx), y: Math.round(screen.y + screen.height * fy) });
    for (const fx of [0.2, 0.7]) {
      await editor.toolButton('Shape').click();
      const p = point(fx, 0.4);
      await page.mouse.click(p.x, p.y);
    }
    await expect(editor.shapes).toHaveCount(2);
    await page.keyboard.press('c');
    await expect(editor.toolButton('Connector')).toHaveAttribute('aria-pressed', 'true');
    const [from, to] = [point(0.2, 0.4), point(0.7, 0.4)];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    const connectors = editor.canvas.locator('.fx-el[data-kind="connector"]');
    await expect(connectors).toHaveCount(1);
    await expect(editor.elements).toHaveCount(3);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
    const before = await connectors.locator('path.fx-route').getAttribute('d');
    await page.keyboard.press('Control+z');
    await expect(connectors).toHaveCount(0);
    await expect(editor.shapes).toHaveCount(2);
    await page.keyboard.press('Control+Shift+z');
    await expect(connectors).toHaveCount(1);
    expect(await connectors.locator('path.fx-route').getAttribute('d')).toBe(before);
    // bound at both ends: nudging a shape re-routes the connector
    await page.mouse.click(from.x, from.y);
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => connectors.locator('path.fx-route').getAttribute('d')).not.toBe(before);
  });
});
