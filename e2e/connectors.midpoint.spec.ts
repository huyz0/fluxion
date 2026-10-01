import { drag, handleCentre, joinedPair } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag on a handle: desktop input
test.describe('connector middle handles', { tag: '@desktop' }, () => {
  test('FR-CON-007: dragging the middle of a connector adds a waypoint there, in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    const route = editor.canvas.locator('path[data-route]');
    const straight = await route.getAttribute('d');
    await expect(editor.canvas.locator('[data-connector-handle^="mid-"]')).toHaveCount(1);
    const mid = await handleCentre(editor, 'mid-0');
    await drag(page, mid, { x: mid.x, y: mid.y + 80 });
    // the route bends through the dropped point: two stretches, so two middles
    await expect(editor.canvas.locator('[data-connector-handle^="mid-"]')).toHaveCount(2);
    expect(await route.getAttribute('d')).not.toBe(straight);
    const bent = await handleCentre(editor, 'target');
    expect(bent.x).toBeGreaterThan(mid.x);
    // one undo straightens it again
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.canvas.locator('[data-connector-handle^="mid-"]')).toHaveCount(1);
    expect(await route.getAttribute('d')).toBe(straight);
  });
});
