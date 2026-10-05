import { readFileSync } from 'node:fs';
import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { expect, test } from './test.js';

// FR-FIL-002, FR-PRS-001: the R1 journey, by hand and nothing else. Five screens are made in the editor (each with a line of text typed into a text box), the
// document is saved, a fresh page opens the saved file, and the deck is presented with the keys from the first screen to the last and back.
const LINES = ['Welcome to Fluxion', 'Draw shapes and connect them', 'Write text in place', 'Save one portable file', 'Present it anywhere'];

// the editor takes the pointer, the keys and the file pickers: desktop input
test.describe('create, save, reopen, present', { tag: '@desktop' }, () => {
  test.setTimeout(120_000);

  test('FR-FIL-002: five screens made by hand are saved, reopened in a new page and presented from the first screen to the last', async ({ page, browser }) => {
    const editor = new EditorPage(page);
    await pickers(page, undefined);
    await editor.open('new');
    const screens = editor.panel('Screens, library and layers');
    for (let i = 1; i < LINES.length; i++) await screens.getByRole('button', { name: 'New screen', exact: true }).click();
    await expect(screens.locator('.fx-chrome-screen')).toHaveCount(LINES.length);

    // each screen gets a text box with its line
    for (const [i, line] of LINES.entries()) {
      await editor.screenTab(`Screen ${i + 1}`).click();
      await dragOut(page, editor, 'Text');
      await expect(editor.elements).toHaveCount(1);
      const at = await editor.elements.first().boundingBox();
      if (at === null) throw new Error('the text box is not drawn');
      await page.mouse.dblclick(at.x + at.width / 2, at.y + at.height / 2);
      await expect(editor.canvas.getByTestId('text-editor')).toBeVisible();
      await page.keyboard.type(line);
      await page.keyboard.press('Escape');
      await expect(editor.elements.first().locator('.fx-label')).toHaveText(line);
    }

    // Save: this engine has no file system access, so the save is a download of the whole file
    const download = page.waitForEvent('download');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await download;
    const path = await saved.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(200);

    // a fresh page opens the saved file
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      await pickers(fresh, asPicker(saved.suggestedFilename(), bytes));
      await fresh.goto('/');
      await fresh.getByRole('button', { name: 'Open a file…' }).click();
      const reopened = new EditorPage(fresh);
      await reopened.screens.first().waitFor();
      await expect(reopened.panel('Screens, library and layers').locator('.fx-chrome-screen')).toHaveCount(LINES.length);
      await expect(reopened.elements.first().locator('.fx-label')).toHaveText(LINES[0] as string);
      expect(await writes(fresh)).toEqual([]);

      // present: F5 from the first screen, the right arrow to the last, and the left arrow back
      await fresh.keyboard.press('F5');
      await expect(reopened.root).toHaveAttribute('data-mode', 'present');
      const shown = fresh.getByTestId('present-in-place').locator('.fx-label').first();
      await expect(shown).toHaveText(LINES[0] as string);
      for (const line of LINES.slice(1)) {
        await fresh.keyboard.press('ArrowRight');
        await expect(shown).toHaveText(line);
      }
      for (const line of LINES.slice(0, -1).reverse()) {
        await fresh.keyboard.press('ArrowLeft');
        await expect(shown).toHaveText(line);
      }
      await fresh.keyboard.press('Escape');
      await expect(reopened.root).toHaveAttribute('data-mode', 'edit');
    } finally {
      await context.close();
    }
  });
});
