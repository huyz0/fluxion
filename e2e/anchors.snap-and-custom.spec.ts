import { drag, handleCentre, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// mouse drags onto anchors: desktop input
test.describe('anchors while connecting', { tag: '@desktop' }, () => {
  test('FR-ANC-006: dragging a connector end over a shape shows its anchors, and a drop near one snaps the end onto it', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.6, 2);
    const second = await editor.elements.nth(1).boundingBox();
    if (second === null) throw new Error('no second shape');
    // the anchor n of the second shape: the middle of its top side
    const north = { x: second.x + second.width / 2, y: second.y };
    await editor.toolButton('Connector').click();
    const from = await onScreen(editor, 0.16, 0.4);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(north.x - 20, north.y + 30, { steps: 6 });
    // over the shape: its anchors show, none snapped yet
    const dots = editor.canvas.locator('[data-anchor-dot]');
    await expect(dots).toHaveCount(4);
    await expect(editor.canvas.locator('[data-anchor-dot][data-snapped]')).toHaveCount(0);
    // a few px from n, still inside the shape: n is marked
    await page.mouse.move(north.x + 3, north.y + 3, { steps: 4 });
    await expect(editor.canvas.locator('[data-anchor-dot="n"][data-snapped]')).toHaveCount(1);
    await page.mouse.up();
    await expect(dots).toHaveCount(0);
    await expect(editor.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    // the new connector is selected: its target end sits on n, not at the pointer
    const end = await handleCentre(editor, 'target');
    expect(Math.abs(end.x - north.x)).toBeLessThan(1.5);
    expect(Math.abs(end.y - north.y)).toBeLessThan(1.5);
  });

  test('FR-ANC-006: a drop on a shape away from every anchor binds where routing picks, not to an anchor it was not near', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.6, 2);
    await editor.toolButton('Connector').click();
    // inside the second shape, between its centre and its top-left corner: far from every anchor
    await drag(page, await onScreen(editor, 0.16, 0.4), await onScreen(editor, 0.63, 0.34));
    await expect(editor.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    const second = await editor.elements.nth(1).boundingBox();
    if (second === null) throw new Error('no second shape');
    // auto: the end faces the source, on the left side of the shape
    const end = await handleCentre(editor, 'target');
    expect(Math.abs(end.x - second.x)).toBeLessThan(1.5);
  });
});
