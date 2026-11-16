import { onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

// the context menu and the pointer: desktop input
test.describe('boolean operations from the UI', { tag: '@desktop' }, () => {
  test('FR-SHP-010: Union from the context menu makes one shape of two overlapping ones, in one undo step', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.18, 2);
    const before = await Promise.all((await editor.shapes.all()).map(async (s) => (await s.boundingBox()) as Box));
    await page.keyboard.press('ControlOrMeta+a');
    const on = await onScreen(editor, 0.12, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Union' }).click();
    await expect(editor.shapes).toHaveCount(1);
    const union = (await editor.shapes.first().boundingBox()) as Box;
    // the union spans both: from the first's left edge to the second's right edge
    expect(union.x).toBeCloseTo(Math.min(...before.map((b) => b.x)), -1);
    expect(union.x + union.width).toBeCloseTo(Math.max(...before.map((b) => b.x + b.width)), -1);
    await editor.toolbarButton('Undo').click();
    await expect(editor.shapes).toHaveCount(2);
    await expectAccessible();
  });
});
