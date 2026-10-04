import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

/** Set the title of the open document through the details dialog (a real edit). */
async function retitle(page: Page, editor: EditorPage, title: string): Promise<void> {
  await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Document details' });
  await form.getByLabel('Title').fill(title);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

const status = (page: Page) => page.getByTestId('autosave-status');

// storage and locks are the engine's own: the same spec runs on all three engines
test.describe('autosave in the editor', { tag: '@desktop' }, () => {
  test('FR-FIL-007: an edit is written within the autosave budget and the status line says the changes are kept', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/edit/new');
    await editor.screens.first().waitFor();
    await retitle(page, editor, 'Kept on this device');
    await expect(status(page)).toContainText(/Saving|kept on this device/);
    // NFR-REL-001: written no later than 5 s after the change
    await expect(status(page)).toContainText('kept on this device', { timeout: 5000 });
  });

  test('FR-FIL-007: a second tab on the same file opens it read-only and says so, while the first tab and another document are not held', async ({
    context,
    page,
  }) => {
    const bytes = asPicker('shared.flux', await fluxFileOf('minimal'));
    await pickers(page, bytes);
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    await expect(status(page)).toContainText('kept on this device');
    const second = await context.newPage();
    await pickers(second, bytes);
    await second.goto('/');
    await second.getByRole('button', { name: 'Open a file…' }).click();
    await expect(status(second)).toContainText('read-only');
    await retitle(page, editor, 'Still editable');
    await expect(status(page)).not.toContainText('read-only');
    // a new document in another tab is a different document
    const other = await context.newPage();
    await other.goto('/edit/new');
    await expect(status(other)).toBeVisible();
    await expect(status(other)).not.toContainText('read-only');
  });
});
