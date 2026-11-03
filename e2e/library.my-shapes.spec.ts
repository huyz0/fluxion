import { readFileSync } from 'node:fs';
import { drag, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// clicks, a drag, keys and a file input in the library panel: desktop input; the same spec runs on all three engines
test.describe('My shapes', { tag: '@desktop' }, () => {
  test('FR-LIB-008: WHEN a user saves a group to My shapes and opens a second document THE SYSTEM SHALL insert that reusable group', async ({
    page,
    browser,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.6, 2);
    await editor.toolButton('Connector').click();
    await drag(page, await onScreen(editor, 0.16, 0.4), await onScreen(editor, 0.66, 0.4));
    const connectors = editor.canvas.locator('.fx-el[data-kind="connector"]');
    await expect(connectors).toHaveCount(1);
    // everything selected and grouped, then saved under a name
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+g');
    await expect(editor.canvas.locator('.fx-el[data-kind="group"]')).toHaveCount(1);
    const panel = editor.panel('Screens, library and layers');
    await panel.getByRole('tab', { name: 'Library', exact: true }).click();
    const mine = panel.getByRole('region', { name: 'My shapes' });
    await mine.getByRole('button', { name: 'Save selection to My shapes' }).click();
    await mine.getByRole('textbox', { name: 'Name of the saved shape' }).fill('Linked pair');
    await mine.getByRole('textbox', { name: 'Name of the saved shape' }).press('Enter');
    const item = mine.getByRole('button', { name: 'Linked pair', exact: true });
    await expect(item).toBeVisible();

    // a second document in the same browser: the item is there, and a click inserts the group with its connector
    await editor.open('new');
    await expect(editor.elements).toHaveCount(0);
    await panel.getByRole('tab', { name: 'Library', exact: true }).click();
    await item.click();
    await expect(editor.shapes).toHaveCount(2);
    await expect(connectors).toHaveCount(1);
    await expect(editor.canvas.locator('.fx-el[data-kind="group"]')).toHaveCount(1);

    // exported, then imported by a browser that has none
    const download = page.waitForEvent('download');
    await mine.getByRole('button', { name: 'Export My shapes' }).click();
    const saved = await download;
    const bytes = readFileSync((await saved.path()) as string);
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      const other = new EditorPage(fresh);
      await other.open('new');
      const left = other.panel('Screens, library and layers');
      await left.getByRole('tab', { name: 'Library', exact: true }).click();
      const theirs = left.getByRole('region', { name: 'My shapes' });
      await expect(theirs.getByRole('button', { name: 'Linked pair', exact: true })).toHaveCount(0);
      await theirs.getByLabel('My shapes file to import').setInputFiles({ name: 'my-shapes.json', mimeType: 'application/json', buffer: bytes });
      await theirs.getByRole('button', { name: 'Linked pair', exact: true }).click();
      await expect(other.shapes).toHaveCount(2);
      await expect(other.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
});
