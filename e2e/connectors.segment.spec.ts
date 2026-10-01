import { drag, handleCentre, routeType, stepPair } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag on a handle: desktop input
test.describe('orthogonal connector segments', { tag: '@desktop' }, () => {
  test('FR-CON-007: dragging the middle segment of an elbow route moves it across, in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await stepPair(page, editor);
    await routeType(editor, 'orthogonal');
    const route = editor.canvas.locator('path[data-route]');
    // the elbow has one handle on its middle segment (the stubs out of the shapes have none)
    const segments = editor.canvas.locator('[data-connector-handle^="seg-"]');
    await expect(segments).toHaveCount(1);
    const before = await route.getAttribute('d');
    const name = (await segments.first().getAttribute('data-connector-handle')) as string;
    const mid = await handleCentre(editor, name);
    await drag(page, mid, { x: mid.x + 60, y: mid.y });
    const moved = await handleCentre(editor, name);
    expect(moved.x).toBeGreaterThan(mid.x + 50);
    // across only: along the segment it stays where it was (the ends float to face the new corner, a few px)
    expect(Math.abs(moved.y - mid.y)).toBeLessThan(15);
    expect(await route.getAttribute('d')).not.toBe(before);
    // the route is still elbows: every stretch of its path is horizontal or vertical
    const d = (await route.getAttribute('d')) ?? '';
    const points = [...d.matchAll(/[ML]\s*([-\d.]+)[ ,]([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as number[], points[i] as number[]];
      expect(a[0] === b[0] || a[1] === b[1], `${a} to ${b}`).toBe(true);
    }
    // one undo puts the segment back
    await page.keyboard.press('ControlOrMeta+z');
    expect(await route.getAttribute('d')).toBe(before);
  });
});
