import { EditorPage } from './pages/editor.js';
import { openFonts } from './pages/fonts.js';
import { expect, test } from './test.js';

// The editor's accessibility pass (NFR-A11Y-001, M9.21): axe finds nothing serious or critical in any state of the editor: the
// document as it opens (the toolbar with the theme controls and Fonts), a selection, the font picker on each of its tabs, the keyboard
// shortcuts dialog, the command palette and the element context menu. The same specs run on all three engines.
test.describe('editor accessibility', { tag: '@desktop' }, () => {
  // many states, each scanned by axe: Firefox on a shared runner needs more than the default 30 s (CI flake at ed63156)
  test.setTimeout(120_000);

  test('NFR-A11Y-001: the editor has no serious or critical axe finding in any state', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    // the empty document: no element, the inspector with nothing selected
    await editor.open('new');
    await expectAccessible();
    await editor.open('example-shapes-gallery');
    // the toolbar names its controls, the new ones included
    await expect(editor.root.getByLabel('Theme', { exact: true })).toBeVisible();
    await expect(editor.root.getByRole('button', { name: 'Fonts', exact: true })).toBeVisible();
    await expectAccessible();

    // a selection, with the inspector open
    const rect = await editor.shapes.first().boundingBox();
    if (rect === null) throw new Error('the first shape is not drawn');
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await expectAccessible();

    // the context menu of the element
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expectAccessible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // the font picker on each tab, and focus back on its button when it closes
    await openFonts(editor);
    const fonts = page.getByRole('dialog', { name: 'Fonts' });
    await expect(fonts).toBeVisible();
    for (const tab of ['Document', 'Bundled', 'Google', 'Upload']) {
      await fonts.getByRole('tab', { name: tab }).click();
      // the catalog loads when the tab opens: axe sees the list of families, not the loading line
      if (tab === 'Google') await expect(fonts.getByRole('button', { name: /^Add / }).first()).toBeVisible({ timeout: 15_000 });
      await expectAccessible();
    }
    await page.keyboard.press('Escape');
    await expect(fonts).toHaveCount(0);
    await expect(editor.root.getByRole('button', { name: 'Fonts', exact: true })).toBeFocused();

    // the document details dialog, empty and with a field error shown
    await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Document details' });
    await expect(details).toBeVisible();
    await expectAccessible();
    await details.getByLabel('Language').fill('not a tag');
    await details.getByRole('button', { name: 'Add a custom field' }).click();
    await expect(details.getByRole('alert').first()).toBeVisible();
    await expectAccessible();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

    // the keyboard shortcuts dialog and the command palette
    await page.keyboard.press('?');
    await expect(editor.keymapDialog).toBeVisible();
    await expectAccessible();
    await page.keyboard.press('Escape');
    await expect(editor.keymapDialog).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: /command/i });
    await expect(palette).toBeVisible();
    await expectAccessible();
    // a query that finds nothing: the palette's empty row
    await page.keyboard.type('zzzz-no-such-command');
    await expectAccessible();
    await page.keyboard.press('Escape');
  });

  test('NFR-A11Y-001: every control of the new toolbar groups is reachable and operable by keyboard', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // the Fonts button opens the dialog from the keyboard, Escape closes it, and the Theme select is a named combobox
    await editor.root.getByRole('button', { name: 'Fonts', exact: true }).focus();
    await page.keyboard.press('Enter');
    const fonts = page.getByRole('dialog', { name: 'Fonts' });
    await expect(fonts).toBeVisible();
    // the first control of the dialog has focus, and Tab stays inside it
    await expect(fonts.getByRole('tab', { name: 'Document' })).toBeFocused();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await fonts.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(fonts).toHaveCount(0);
    await expect(editor.root.getByLabel('Theme', { exact: true })).toBeEnabled();
    await editor.root.getByLabel('Theme', { exact: true }).selectOption({ label: 'dark' });
    await expect(editor.root.getByLabel('Theme', { exact: true })).toHaveValue('theme-dark');
  });
});
