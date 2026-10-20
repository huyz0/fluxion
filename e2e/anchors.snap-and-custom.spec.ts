import { readFileSync } from 'node:fs';
import { drag, handleCentre, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
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

  test('FR-ANC-005: a custom anchor added in the inspector persists after save and reopen, and a connector end snaps to it', async ({ page, browser }) => {
    const editor = new EditorPage(page);
    await pickers(page, undefined);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.6, 2);
    // the second shape (still selected): an anchor of its own, moved to its left side a fifth down
    const anchors = editor.panel('Inspector').locator('[data-anchors]');
    await anchors.getByRole('button', { name: 'Add anchor' }).click();
    const across = anchors.getByLabel('Anchor a1 across');
    await across.fill('0');
    await across.press('Enter');
    const down = anchors.getByLabel('Anchor a1 down');
    await down.fill('0.2');
    await down.press('Enter');
    await expect(anchors.locator('[data-anchor-row="a1"]')).toHaveCount(1);

    const download = page.waitForEvent('download');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await download;
    const bytes = readFileSync((await saved.path()) as string);

    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      await pickers(fresh, asPicker(saved.suggestedFilename(), bytes));
      await fresh.goto('/');
      await fresh.getByRole('button', { name: 'Open a file…' }).click();
      const reopened = new EditorPage(fresh);
      await reopened.screens.first().waitFor();
      await expect(reopened.elements).toHaveCount(2);
      const second = await reopened.elements.nth(1).boundingBox();
      if (second === null) throw new Error('no second shape');
      // the anchor came back with the file
      await fresh.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
      await expect(reopened.panel('Inspector').locator('[data-anchor-row="a1"]')).toHaveCount(1);
      // a connector dragged to near it shows it marked and ends on it
      const a1 = { x: second.x, y: second.y + second.height * 0.2 };
      await reopened.toolButton('Connector').click();
      const from = await onScreen(reopened, 0.16, 0.4);
      await fresh.mouse.move(from.x, from.y);
      await fresh.mouse.down();
      await fresh.mouse.move(a1.x + 30, a1.y + 30, { steps: 6 });
      await fresh.mouse.move(a1.x + 3, a1.y + 2, { steps: 4 });
      await expect(reopened.canvas.locator('[data-anchor-dot="a1"][data-snapped]')).toHaveCount(1);
      await fresh.mouse.up();
      await expect(reopened.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
      const end = await handleCentre(reopened, 'target');
      expect(Math.abs(end.x - a1.x)).toBeLessThan(1.5);
      expect(Math.abs(end.y - a1.y)).toBeLessThan(1.5);
    } finally {
      await context.close();
    }
  });
});
