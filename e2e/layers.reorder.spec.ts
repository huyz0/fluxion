import type { Page } from '@playwright/test';
import { shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** A new document with three shapes, and the Layers tab open. */
async function threeShapes(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.open('new');
  for (const [i, fx] of [0.15, 0.45, 0.75].entries()) await shapeAt(page, editor, fx, i + 1);
  await editor.panel('Screens, library and layers').getByRole('tab', { name: 'Layers' }).click();
  await expect(layerRows(editor)).toHaveCount(3);
  return editor;
}

const layerRows = (editor: EditorPage) => editor.panel('Screens, library and layers').locator('.fx-chrome-layer');
/** The layer ids top to bottom: front first. */
const layers = (editor: EditorPage) => layerRows(editor).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-layer-id')));
/** The canvas's elements in paint order: back first. */
const painted = (editor: EditorPage) => editor.elements.evaluateAll((all) => all.map((e) => e.getAttribute('data-el-id')));

// a drag in the panel: desktop input
test.describe('the layers panel', { tag: '@desktop' }, () => {
  test('FR-ARR-008: dragging a row changes the canvas z-order, undone in one step; the toggles hide and lock', async ({ page, expectAccessible }) => {
    const editor = await threeShapes(page);
    const [front, middle, back] = (await layers(editor)) as [string, string, string];
    expect(await painted(editor)).toEqual([back, middle, front]);
    await expectAccessible();
    const rows = layerRows(editor);
    // the back row dropped on the upper half of the front row goes in front of it, on the canvas too
    await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 3 } });
    await expect.poll(() => layers(editor)).toEqual([back, front, middle]);
    await expect.poll(() => painted(editor)).toEqual([middle, front, back]);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => layers(editor)).toEqual([front, middle, back]);
    // the eye and the lock of the front row
    const row = rows.first();
    await row.getByRole('button', { name: /^Hide / }).click();
    await expect(row).toHaveAttribute('data-hidden', 'true');
    await row.getByRole('button', { name: /^Lock / }).click();
    await expect(row).toHaveAttribute('data-locked', 'true');
    await expectAccessible();
    await editor.toolbarButton('Undo').click();
    await expect(row).not.toHaveAttribute('data-locked', 'true');
    await expect(row).toHaveAttribute('data-hidden', 'true');
  });
});
