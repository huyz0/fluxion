import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

// NFR-SEC-006: no telemetry. A session of editing, saving and presenting makes no request to a non-local host. The fixture in test.ts blocks every such request and keeps
// what it blocked (`blocked`); this spec also watches the page's own requests, so a host that is local but not the studio's is caught as well.
test.describe('no telemetry', { tag: '@desktop' }, () => {
  test('NFR-SEC-006: a session of edit, save and present makes no request to a non-local host', async ({ page, blocked }) => {
    const hosts = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.hostname);
    });
    await pickers(page, asPicker('minimal.flux', await fluxFileOf('minimal')));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    // an edit: the document's title, through the details dialog
    await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Document details' });
    await form.getByLabel('Title').fill('A private title');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toHaveCount(0);
    // a save, through the file's own handle
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    expect(await writes(page)).toHaveLength(1);
    // the diagnostic report is copied, not sent
    await page.getByRole('button', { name: 'Copy diagnostic report' }).click();
    // present, and move through it
    await page.keyboard.press('F5');
    await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'present');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'edit');
    // nothing went to a non-local host, and every host the page spoke to is the studio's own
    expect(blocked).toEqual([]);
    expect([...hosts].every((h) => h === 'localhost' || h === '127.0.0.1')).toBe(true);
  });
});
