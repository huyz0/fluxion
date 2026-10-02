import type { Page } from '@playwright/test';
import { onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

/** Two shapes side by side with the same top (left and right of a new document). */
async function pair(page: Page) {
  const editor = new EditorPage(page);
  await editor.open('new');
  await shapeAt(page, editor, 0.1, 1);
  await shapeAt(page, editor, 0.5, 2);
  return editor;
}

const shapeBoxes = async (editor: EditorPage): Promise<[Box, Box]> => {
  const [a, b] = await Promise.all((await editor.shapes.all()).map(async (s) => (await s.boundingBox()) as Box));
  if (a === undefined || b === undefined) throw new Error('two shapes');
  return [a, b];
};

/** Press on the right shape, pull it 60 px down, then back to 5 px below where it started, and stop there (no release). */
async function pullAway(page: Page, editor: EditorPage): Promise<void> {
  const at = await onScreen(editor, 0.56, 0.4);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 60, { steps: 4 });
  await page.mouse.move(at.x, at.y + 5, { steps: 4 });
}

// mouse drags: desktop input
test.describe('snapping', { tag: '@desktop' }, () => {
  test('FR-ARR-005: guides appear while dragging and the final position is exact', async ({ page }) => {
    const editor = await pair(page);
    const guides = page.locator('[data-guide]');
    await expect(guides).toHaveCount(0);
    await pullAway(page, editor);
    // 5 px below the other shape's top: within 8 px, so the top edges line up and the guide is drawn
    await expect(page.locator('[data-guide="y"]').first()).toBeAttached();
    const [a, b] = await shapeBoxes(editor);
    expect(b.y).toBeCloseTo(a.y, 3);
    await page.mouse.up();
    await expect(guides).toHaveCount(0);
    const [a1, b1] = await shapeBoxes(editor);
    expect(b1.y).toBeCloseTo(a1.y, 3);
  });

  test('FR-ARR-005: the snapping toggle in the toolbar turns snapping off and the setting persists', async ({ page }) => {
    const editor = await pair(page);
    const toggle = editor.toolbarButton('Snapping');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await pullAway(page, editor);
    await expect(page.locator('[data-guide]')).toHaveCount(0);
    await page.mouse.up();
    const [a, b] = await shapeBoxes(editor);
    expect(b.y - a.y).toBeGreaterThan(3);
    // the setting outlives a reload
    await page.reload();
    await editor.screens.first().waitFor();
    await expect(editor.toolbarButton('Snapping')).toHaveAttribute('aria-pressed', 'false');
  });
});
