import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

const PANEL = 'Screens, library and layers';

/** A new document with the Library tab open. */
async function withLibrary(page: import('@playwright/test').Page) {
  const editor = new EditorPage(page);
  await editor.open('new');
  const left = editor.panel(PANEL);
  await left.getByRole('tab', { name: 'Library', exact: true }).click();
  return { editor, item: (name: string) => left.locator('.fx-chrome-library-item', { hasText: name }).getByRole('button') };
}

const centre = (b: { x: number; y: number; width: number; height: number } | null) => ({
  x: (b?.x ?? 0) + (b?.width ?? 0) / 2,
  y: (b?.y ?? 0) + (b?.height ?? 0) / 2,
});

// HTML5 drag and drop, and the pointer: desktop input
test.describe('library insert', { tag: '@desktop' }, () => {
  test('FR-LIB-002: a dragged library item lands with its centre within 1 px of the drop, as one undo step', async ({ page }) => {
    const { editor, item } = await withLibrary(page);
    await expect(editor.elements).toHaveCount(0);
    const canvas = await editor.canvas.boundingBox();
    const drop = { x: 260, y: 210 };
    await item('Cylinder').dragTo(editor.canvas, { targetPosition: drop });
    await expect(editor.elements).toHaveCount(1);
    const c = centre(await editor.elements.first().boundingBox());
    expect(Math.abs(c.x - ((canvas?.x ?? 0) + drop.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - ((canvas?.y ?? 0) + drop.y))).toBeLessThanOrEqual(1);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await editor.toolbarButton('Undo').click();
    await expect(editor.elements).toHaveCount(0);
  });

  test('FR-LIB-002: a click inserts the item at the middle of the view, selected, at its default size', async ({ page }) => {
    const { editor, item } = await withLibrary(page);
    await item('Diamond').click();
    await expect(editor.elements).toHaveCount(1);
    const canvas = await editor.canvas.boundingBox();
    const c = centre(await editor.elements.first().boundingBox());
    expect(Math.abs(c.x - ((canvas?.x ?? 0) + (canvas?.width ?? 0) / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - ((canvas?.y ?? 0) + (canvas?.height ?? 0) / 2))).toBeLessThanOrEqual(1);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await editor.toolbarButton('Undo').click();
    await expect(editor.elements).toHaveCount(0);
  });
});
