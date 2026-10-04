import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

async function retitle(page: Page, editor: EditorPage, title: string): Promise<void> {
  await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Document details' });
  await form.getByLabel('Title').fill(title);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

// pickers, storage and canvas encoding are the engine's own: the same spec runs on all three engines
test.describe('the local library', { tag: '@desktop' }, () => {
  test('FR-FIL-008: a saved file is listed on the home page with its preview, and opens from the list', async ({ page, browserName }) => {
    await pickers(page, asPicker('library-deck.flux', await fluxFileOf('minimal')));
    const editor = new EditorPage(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Recent files' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    await retitle(page, editor, 'Remembered');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    // the library is written a moment after the file: leave the editor only once the entry is in the database
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open('fluxion-library');
              open.onerror = (e) => {
                e.preventDefault();
                resolve(0);
              };
              // the database does not exist yet: do not create it
              open.onupgradeneeded = () => open.transaction?.abort();
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('entries')) return resolve(0);
                const count = db.transaction('entries').objectStore('entries').count();
                count.onsuccess = () => {
                  db.close();
                  resolve(count.result);
                };
              };
            }),
        ),
      )
      .toBe(1);
    await page.goto('/');
    const item = page.getByRole('region', { name: 'Recent files' }).getByRole('button', { name: /library-deck\.flux/ });
    // the preview is WebP, which only some engines can encode
    if (browserName === 'chromium') await expect(item.locator('img')).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/edit\/file-\d+$/);
    await editor.screens.first().waitFor();
    await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Document details' }).getByLabel('Title')).toHaveValue('Remembered');
  });
});
