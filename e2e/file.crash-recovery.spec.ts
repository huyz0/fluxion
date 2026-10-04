import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { documentRecordOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

/** Set the title of the open document through the details dialog (a real edit). */
async function retitle(page: Page, editor: EditorPage, title: string): Promise<void> {
  await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Document details' });
  await form.getByLabel('Title').fill(title);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

const prompt = (page: Page) => page.getByRole('dialog', { name: 'Recover unsaved changes' });

/** Fill the rest of the details dialog: a description, tags and one custom field, saved as one edit. */
async function describe(page: Page, editor: EditorPage): Promise<void> {
  await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Document details' });
  await form.getByLabel('Description').fill('Written before the crash');
  await form.getByLabel('Tags').fill('alpha, beta');
  await form.getByRole('button', { name: 'Add a custom field' }).click();
  await form.getByLabel('Custom field 1 name').fill('owner');
  await form.getByLabel('Custom field 1 value').fill('Dana');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

/** A tab that edits a new document and is closed once autosave reports the change kept: the work the next start finds. */
async function crashedSession(page: Page, title: string, details = false): Promise<void> {
  const editor = new EditorPage(page);
  await page.goto('/edit/new');
  await editor.screens.first().waitFor();
  await retitle(page, editor, title);
  if (details) await describe(page, editor);
  await expect(page.getByTestId('autosave-status')).toContainText('kept on this device', { timeout: 5000 });
  await page.close();
}

// storage, locks and tabs are the engine's own: the same spec runs on all three engines
test.describe('crash recovery', { tag: '@desktop' }, () => {
  test('FR-FIL-007: a tab closed after an edit leaves the work, and the next start offers it, recovers it with its title, and keeps it as unsaved', async ({
    context,
  }) => {
    await crashedSession(await context.newPage(), 'Crash survivor');
    const next = await context.newPage();
    await next.goto('/');
    await expect(prompt(next)).toBeVisible();
    await expect(prompt(next)).toContainText('Crash survivor');
    await prompt(next).getByRole('button', { name: 'Recover' }).click();
    await expect(next).toHaveURL(/\/edit\/file-\d+$/);
    // the prompt does not stay over the document it just opened
    await expect(prompt(next)).toHaveCount(0);
    const editor = new EditorPage(next);
    await editor.screens.first().waitFor();
    await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
    await expect(next.getByRole('dialog', { name: 'Document details' }).getByLabel('Title')).toHaveValue('Crash survivor');
    await next.keyboard.press('Escape');
    // the recovered document carries on its own journal: closed again without a save, the next start offers it again
    await expect(next.getByTestId('autosave-status')).toContainText('kept on this device', { timeout: 5000 });
    await next.close();
    const again = await context.newPage();
    await again.goto('/');
    await expect(prompt(again)).toContainText('Crash survivor');
  });

  test('FR-FIL-007: the description, tags, custom fields and modified time edited in the details dialog come back after a tab is lost', async ({ context }) => {
    const began = Date.now();
    // the tab is closed with the edit unsaved (no Save, no clean exit); the next start recovers it and a copy saved from it holds all of it
    const first = await context.newPage();
    await pickers(first, asPicker('unused.flux', new Uint8Array()));
    await crashedSession(first, 'Detailed survivor', true);
    const next = await context.newPage();
    await pickers(next, asPicker('unused.flux', new Uint8Array()));
    await next.goto('/');
    await expect(prompt(next)).toContainText('Detailed survivor');
    await prompt(next).getByRole('button', { name: 'Recover' }).click();
    await new EditorPage(next).screens.first().waitFor();
    await next.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(next)).length).toBe(1);
    const record = await documentRecordOf((await writes(next))[0]?.bytes ?? new Uint8Array());
    expect(record.title).toBe('Detailed survivor');
    expect(record.description).toBe('Written before the crash');
    expect(record.tags).toEqual(['alpha', 'beta']);
    expect(record.custom).toEqual({ owner: 'Dana' });
    // `modified` is the time of the edit (it was set by the edits made in this test, so it is not before the test began)
    const modified = Date.parse(record.modified ?? '');
    expect(modified).toBeGreaterThanOrEqual(began - 2000);
    expect(modified).toBeLessThanOrEqual(Date.now() + 2000);
  });

  test('FR-FIL-007: Discard forgets the work for good, and Not now keeps it for the next start', async ({ context }) => {
    await crashedSession(await context.newPage(), 'Throw away');
    const first = await context.newPage();
    await first.goto('/');
    await expect(prompt(first)).toContainText('Throw away');
    await prompt(first).getByRole('button', { name: 'Not now' }).click();
    await expect(prompt(first)).toHaveCount(0);
    const second = await context.newPage();
    await second.goto('/');
    await expect(prompt(second)).toContainText('Throw away');
    await prompt(second).getByRole('button', { name: 'Discard' }).click();
    await expect(prompt(second)).toHaveCount(0);
    const third = await context.newPage();
    await third.goto('/');
    await expect(third.getByTestId('studio-root')).toBeVisible();
    await expect(prompt(third)).toHaveCount(0);
  });
});
