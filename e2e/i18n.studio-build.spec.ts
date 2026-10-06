import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// NFR-I18N-001: the studio is served from its production build, where the macros are runtime calls, descriptors keep only a message id and the English
// catalogs are compiled modules; a bundler that dropped the catalog loading (sideEffects: false) would show no text at all (M11.76, milestone review cp1 F6).
test.describe('the studio build renders its messages', { tag: '@desktop' }, () => {
  test("NFR-I18N-001: the studio's production build renders its English messages", async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // the editor's toolbar and panel names are catalog messages
    await expect(editor.toolbarButton('Undo')).toBeVisible();
    await expect(editor.toolbarButton('Redo')).toBeVisible();
    await expect(editor.panel('Inspector')).toBeVisible();
    // a command title by id (command.palette.open), through the palette
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog').getByText('Command palette')).toBeVisible();
  });
});
