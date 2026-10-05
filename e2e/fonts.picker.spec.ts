import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { mockGoogleFonts, openFonts, robotoBytes, selectedText, textFamily } from './pages/fonts.js';
import { expect, test } from './test.js';

// a dialog, a file input and the routes: desktop input
test.describe('the font picker', { tag: '@desktop' }, () => {
  // adding a font records its metrics in the page (every pair and triple of letters, a few seconds a face)
  test.setTimeout(120_000);

  test('FR-THM-008: a font picked from each source applies to the selected text', async ({ page }) => {
    await mockGoogleFonts(page, 'Roboto');
    const editor = new EditorPage(page);
    await selectedText(page, editor, dragOut);
    await openFonts(editor);
    const dialog = page.getByRole('dialog', { name: 'Fonts' });
    await expect(dialog).toBeVisible();

    // bundled: Inter, with a preview in its own face
    await dialog.getByRole('tab', { name: 'Bundled' }).click();
    await expect(dialog.getByText('Source Serif 4: Hamburgefonstiv')).toBeVisible();
    await dialog.getByRole('button', { name: 'Use Inter', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Inter applied to the selection');
    await expect.poll(() => textFamily(editor)).toContain('Inter');

    // google: search the catalog, add Roboto (mocked), and the text takes it
    await dialog.getByRole('tab', { name: 'Google' }).click();
    // the catalog is on its way when the tab opens: search once it has arrived (or has failed, which the picker says)
    await expect(dialog.getByText('Loading the catalog…')).toBeHidden({ timeout: 30_000 });
    await expect(dialog.getByRole('alert')).toBeHidden();
    await dialog.getByRole('searchbox', { name: 'Search Google Fonts' }).fill('Roboto');
    await dialog.getByRole('button', { name: 'Add Roboto', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Roboto applied to the selection', { timeout: 60_000 });
    await expect.poll(() => textFamily(editor)).toContain('Roboto');

    // upload: a font file the user chose, named by its file
    await dialog.getByRole('tab', { name: 'Upload' }).click();
    await dialog.getByLabel('Font file').setInputFiles({ name: 'Fx-Mine.woff2', mimeType: 'font/woff2', buffer: robotoBytes(700) });
    await expect(dialog.getByRole('status')).toContainText('Fx Mine applied to the selection', { timeout: 30_000 });
    await expect.poll(() => textFamily(editor)).toContain('Fx Mine');

    // the document now holds the two fonts it was given; one undo takes the last application back
    await dialog.getByRole('tab', { name: 'Document' }).click();
    await expect(dialog.getByRole('button', { name: 'Use Roboto', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Use Fx Mine', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => textFamily(editor)).toContain('Roboto');
  });

  test('FR-THM-008: a file that is not a font is refused with a message and changes nothing', async ({ page }) => {
    const editor = new EditorPage(page);
    await selectedText(page, editor, dragOut);
    const before = await textFamily(editor);
    await openFonts(editor);
    const dialog = page.getByRole('dialog', { name: 'Fonts' });
    await dialog.getByRole('tab', { name: 'Upload' }).click();
    await dialog.getByLabel('Font file').setInputFiles({ name: 'photo.woff2', mimeType: 'font/woff2', buffer: Buffer.from('GIF89a not a font at all') });
    await expect(dialog.getByRole('status')).toContainText('not a font');
    expect(await textFamily(editor)).toBe(before);
  });
});
