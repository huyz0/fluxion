import { dragOut, expectOneAddedThenUndone } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('the shape tool', { tag: '@desktop' }, () => {
  test('FR-EDT-003: a drag with the shape tool adds exactly one element at its box, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await expect(editor.elements).toHaveCount(0);
    const box = await dragOut(page, editor, 'Shape');
    await expectOneAddedThenUndone(page, editor, 'shape');
    const drawn = await editor.elements.first().boundingBox();
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    expect(((drawn?.x ?? 0) - screen.x) / scale).toBeCloseTo(box.x, -1);
    expect((drawn?.width ?? 0) / scale).toBeCloseTo(box.w, -1);
  });
});
