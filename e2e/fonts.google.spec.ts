import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { mockGoogleFonts, openFonts, selectedText, textFamily } from './pages/fonts.js';
import { expect, test } from './test.js';

// a dialog and the routes: desktop input
test.describe('Google Fonts', { tag: '@desktop' }, () => {
  // adding a family records the metrics of its four faces in the page (a few seconds each)
  test.setTimeout(120_000);

  test('FR-THM-008: the picked Google font renders', async ({ page }) => {
    const google = await mockGoogleFonts(page, 'Roboto');
    const editor = new EditorPage(page);
    await selectedText(page, editor, dragOut);
    await openFonts(editor);
    const dialog = page.getByRole('dialog', { name: 'Fonts' });
    await dialog.getByRole('tab', { name: 'Google' }).click();
    await dialog.getByRole('searchbox', { name: 'Search Google Fonts' }).fill('Roboto');
    await dialog.getByRole('button', { name: 'Add Roboto', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Roboto applied to the selection', { timeout: 60_000 });

    // the text is drawn in the face the mocked route served: loaded into the page, named Roboto, from the slice's own file
    await expect.poll(() => textFamily(editor)).toContain('Roboto');
    await expect
      .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.replaceAll('"', '') === 'Roboto' && f.status === 'loaded')))
      .toBe(true);
    // what was asked: one stylesheet for the family (weights and styles named) and its files, all from the two Google hosts
    const asked = google.asked();
    expect(asked[0]).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:ital,wght@0,400;0,700;1,400;1,700/);
    expect(asked.slice(1).every((url) => url.startsWith('https://fonts.gstatic.com/'))).toBe(true);
    expect(asked).toHaveLength(5);
  });
});
