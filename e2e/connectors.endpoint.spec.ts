import { drag, handleCentre, joinedPair, onScreen } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// mouse drags on handles: desktop input
test.describe('connector end handles', { tag: '@desktop' }, () => {
  test('FR-CON-007: a selected connector shows selection chrome along its route', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    // drawn along the whole route: one outline, selected, spanning the two shapes
    const route = editor.canvas.locator('path[data-route]');
    await expect(route).toHaveCount(1);
    await expect(route).toHaveClass(/fx-chrome-route-selected/);
    const [source, target] = [await handleCentre(editor, 'source'), await handleCentre(editor, 'target')];
    expect(target.x - source.x).toBeGreaterThan(100);
    // its width is the same on screen at any zoom: the stroke does not scale
    const width = () => route.evaluate((p) => getComputedStyle(p).strokeWidth);
    const before = await width();
    await editor.zoomButton('Zoom in').click();
    await editor.zoomButton('Zoom in').click();
    expect(await width()).toBe(before);
    expect(await editor.canvas.locator('[data-connector-handle="mid-0"]').count()).toBe(1);
    // nothing selected: no outline and no handles
    await editor.zoomButton('Fit').click();
    const empty = await onScreen(editor, 0.4, 0.9);
    await page.mouse.click(empty.x, empty.y);
    await expect(route).toHaveCount(0);
    await expect(editor.canvas.locator('[data-connector-handle]')).toHaveCount(0);
    // hovering it outlines it, lighter, with no handles
    const over = await onScreen(editor, 0.4, 0.4);
    await page.mouse.move(over.x, over.y);
    await expect(route).toHaveCount(1);
    await expect(route).not.toHaveClass(/fx-chrome-route-selected/);
    await expect(editor.canvas.locator('[data-connector-handle]')).toHaveCount(0);
  });

  test('FR-CON-007: dragging an end onto another shape binds it there, at the anchor nearest, in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    // the select tool back, the connector selected again by a click on its line
    await editor.toolButton('Select').click();
    const line = await onScreen(editor, 0.4, 0.4);
    await page.mouse.click(line.x, line.y);
    await expect(editor.canvas.locator('[data-connector-handle="target"]')).toHaveCount(1);
    const before = await handleCentre(editor, 'target');
    // a third shape below the second, and the target end dragged onto it
    await editor.toolButton('Shape').click();
    await drag(page, await onScreen(editor, 0.6, 0.65), await onScreen(editor, 0.72, 0.85));
    await expect(editor.elements).toHaveCount(4);
    await editor.toolButton('Select').click();
    await page.mouse.click(line.x, line.y);
    const from = await handleCentre(editor, 'target');
    await drag(page, from, await onScreen(editor, 0.66, 0.75));
    const after = await handleCentre(editor, 'target');
    // the end moved down onto the third shape's edge, not to the pointer
    expect(after.y).toBeGreaterThan(before.y + 20);
    const third = await editor.elements.nth(3).boundingBox();
    expect(after.y).toBeGreaterThanOrEqual((third?.y ?? 0) - 3);
    expect(after.y).toBeLessThanOrEqual((third?.y ?? 0) + (third?.height ?? 0) + 3);
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await handleCentre(editor, 'target');
    expect(Math.abs(undone.y - before.y)).toBeLessThan(2);
    expect(Math.abs(undone.x - before.x)).toBeLessThan(2);
  });
});
