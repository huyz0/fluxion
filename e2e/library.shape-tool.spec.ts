import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The outline of the first shape on the canvas: `C` only in a curved one (the cylinder), never in a rectangle. */
const outline = (editor: EditorPage) => editor.shapes.first().locator('path').first().getAttribute('d');

// a mouse drag: desktop input
test.describe('the shape tool and the library', { tag: '@desktop' }, () => {
  test('FR-EDT-003: WHEN a non-rect library item is current THE SYSTEM SHALL draw it with R', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // before any pick, R draws a rectangle
    await dragOut(page, editor, 'Shape');
    await expect(editor.shapes).toHaveCount(1);
    expect(await outline(editor)).not.toContain('C');
    await editor.toolbarButton('Undo').click();
    await expect(editor.shapes).toHaveCount(0);
    // pick the cylinder in the library (it is inserted, and becomes the current item), take the insert back, then draw
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    await left.locator('.fx-chrome-library-item', { hasText: 'Cylinder' }).getByRole('button').click();
    await expect(editor.shapes).toHaveCount(1);
    await editor.toolbarButton('Undo').click();
    await expect(editor.shapes).toHaveCount(0);
    await dragOut(page, editor, 'Shape');
    await expect(editor.shapes).toHaveCount(1);
    expect(await outline(editor)).toContain('C');
  });
});
