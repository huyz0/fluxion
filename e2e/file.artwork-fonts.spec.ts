import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { artworkFontFile, savedArtworkFont } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

/** The loaded faces of the page under `family`. */
const faces = (page: Page, family: string) =>
  page.evaluate((name) => [...document.fonts].filter((face) => face.family.replaceAll('"', '') === name).map((face) => face.status), family);

/** The family the artwork's text is drawn in, as the page computes it. */
const drawnIn = (page: Page) =>
  page
    .locator('.fx-artwork text')
    .first()
    .evaluate((text) => getComputedStyle(text).fontFamily.replaceAll('"', ''));

// keyboard undo and redo, and F5: desktop input
test.describe('retained artwork fonts in the studio', { tag: '@desktop' }, () => {
  test('FR-LIB-004 FR-AST-003: a file draws its artwork text in its exact retained face, through undo, redo and presenting, and saves the bytes back', async ({
    page,
  }) => {
    const file = await artworkFontFile();
    const alias = `fx-artwork-${file.sha256}`;
    await pickers(page, asPicker('label.flux', file.bytes));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    const editor = new EditorPage(page);
    await editor.screens.first().waitFor();
    const artwork = editor.screens.first().locator('.fx-artwork');
    await expect(artwork).toHaveCount(1);
    expect(await drawnIn(page)).toBe(alias);
    expect(await faces(page, alias)).toEqual(['loaded']);
    // the studio's own Inter is still the ordinary face of that family: the artwork's bytes never take its name
    await expect.poll(() => faces(page, 'Inter')).toContain('loaded');

    // the registration belongs to the file, not to the edits: deleting, undoing and redoing keep it
    const box = await artwork.boundingBox();
    if (box === null) throw new Error('artwork not laid out');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Delete');
    await expect(artwork).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(artwork).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(artwork).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(artwork).toHaveCount(1);
    expect(await drawnIn(page)).toBe(alias);
    expect(await faces(page, alias)).toEqual(['loaded']);

    // presented in place, and on the present route
    await page.keyboard.press('F5');
    await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'present');
    expect(await drawnIn(page)).toBe(alias);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'edit');

    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = await savedArtworkFont((await writes(page))[0]?.bytes ?? new Uint8Array(), file.sha256);
    expect(saved.versions).toEqual(['1.1']);
    expect(saved.font?.length).toBe(23664);

    const path = new URL(page.url()).pathname;
    await page.evaluate(
      (to) => {
        window.history.pushState(null, '', to);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      path.replace('/edit/', '/present/'),
    );
    await expect(page.locator('.fx-artwork')).toHaveCount(1);
    expect(await drawnIn(page)).toBe(alias);
    expect(await faces(page, alias)).toEqual(['loaded']);

    // closing the file releases its faces
    await page.evaluate(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(() => faces(page, alias)).toEqual([]);
  });
});
