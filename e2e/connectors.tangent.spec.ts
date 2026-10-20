import { drag, handleCentre, joinedPair, routeType } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag on a handle: desktop input
test.describe('curved connector tangent handles', { tag: '@desktop' }, () => {
  test('FR-CON-007: a curved connector has a tangent handle at each end, and dragging one reshapes the curve in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    // a straight connector has none
    await expect(editor.canvas.locator('[data-connector-handle^="tan-"]')).toHaveCount(0);
    await routeType(editor, 'curved');
    await expect(editor.canvas.locator('[data-connector-handle^="tan-"]')).toHaveCount(2);
    const route = editor.canvas.locator('path[data-route]');
    const before = await route.getAttribute('d');
    // dragging the source's tangent steepens how the curve leaves it
    const tan = await handleCentre(editor, 'tan-0');
    await drag(page, tan, { x: tan.x, y: tan.y - 80 });
    const bent = await route.getAttribute('d');
    expect(bent).not.toBe(before);
    expect(bent).toContain('C');
    // the handle follows the drag and the end handles stay where they were
    const moved = await handleCentre(editor, 'tan-0');
    expect(Math.abs(moved.y - (tan.y - 80))).toBeLessThan(3);
    // one undo step puts the curve back
    await page.keyboard.press('ControlOrMeta+z');
    expect(await route.getAttribute('d')).toBe(before);
  });
});
