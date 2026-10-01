import { drag, handleCentre, joinedPair, routeType } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag on a handle: desktop input
test.describe('curved connector control points', { tag: '@desktop' }, () => {
  test('FR-CON-007: a waypoint pulls a curved route through it, and dragging it reshapes the curve, one undo step each', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    await routeType(editor, 'curved');
    const route = editor.canvas.locator('path[data-route]');
    const flat = await route.getAttribute('d');
    expect(flat).toContain('C');
    // a middle dragged out becomes a control point the curve passes through: it keeps its type and gets a handle of its own
    const mid = await handleCentre(editor, 'mid-0');
    await drag(page, mid, { x: mid.x, y: mid.y - 90 });
    await expect(editor.canvas.locator('[data-connector-handle="way-0"]')).toHaveCount(1);
    const pulled = await route.getAttribute('d');
    expect(pulled).not.toBe(flat);
    expect(pulled).toContain('C');
    const way = await handleCentre(editor, 'way-0');
    expect(Math.abs(way.y - (mid.y - 90))).toBeLessThan(3);
    // dragging the control point moves the curve with it
    await drag(page, way, { x: way.x + 40, y: way.y + 150 });
    const reshaped = await route.getAttribute('d');
    expect(reshaped).not.toBe(pulled);
    const moved = await handleCentre(editor, 'way-0');
    expect(moved.y).toBeGreaterThan(way.y + 140);
    // each drag is one undo step
    await page.keyboard.press('ControlOrMeta+z');
    expect(await route.getAttribute('d')).toBe(pulled);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await route.getAttribute('d')).toBe(flat);
  });
});
