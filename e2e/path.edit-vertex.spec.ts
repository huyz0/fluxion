import { drag, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

// double-click and the pointer: desktop input
test.describe('the path tool', { tag: '@desktop' }, () => {
  test('FR-SHP-011: dragging a vertex of a path shape updates its path; one Ctrl+Z restores it', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // a path shape: the union of two overlapping shapes
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.18, 2);
    await page.keyboard.press('ControlOrMeta+a');
    const inside = await onScreen(editor, 0.12, 0.4);
    await page.mouse.click(inside.x, inside.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Union' }).click();
    await expect(editor.shapes).toHaveCount(1);
    const shape = editor.shapes.first();
    const before = (await shape.boundingBox()) as Box;
    const d = () => shape.locator('path').first().getAttribute('d');
    const original = await d();
    // a double-click edits its vertices: a rectangle-like union has its corners as vertices
    await page.mouse.dblclick(inside.x, inside.y);
    const vertices = editor.canvas.locator('[data-path-vertex]');
    await expect(vertices).not.toHaveCount(0);
    await expectAccessible();
    // the bottom-right-most vertex dragged down and right
    const boxes = await vertices.evaluateAll((all) =>
      all.map((v) => {
        const r = v.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
    const corner = boxes.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
    await drag(page, corner, { x: corner.x + 60, y: corner.y + 50 });
    await expect.poll(d).not.toBe(original);
    const after = (await shape.boundingBox()) as Box;
    expect(after.x + after.width).toBeGreaterThan(before.x + before.width + 40);
    expect(after.y + after.height).toBeGreaterThan(before.y + before.height + 30);
    await expect(editor.canvas.locator('.fx-chrome-path-vertex-selected')).toHaveCount(1);
    // the drag is one undo step
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(d).toBe(original);
    const undone = (await shape.boundingBox()) as Box;
    expect(undone.x + undone.width).toBeCloseTo(before.x + before.width, 0);
    // Esc leaves path editing
    await page.keyboard.press('Escape');
    await expect(vertices).toHaveCount(0);
  });
});
