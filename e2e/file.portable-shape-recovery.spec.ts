import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { portableShapeFile, savedShapeData } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

for (const legacy of [false, true]) {
  test(`FR-FIL-007 FR-LIB-009: crash recovery retains ${legacy ? 'loaded missing-reference provenance' : 'embedded geometry and opaque data'} through Save`, async ({
    page,
    context,
  }) => {
    await pickers(page, asPicker('shapes.flux', await portableShapeFile(legacy)));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    const editor = new EditorPage(page);
    await editor.screens.first().waitFor();
    await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Document details' });
    await details.getByLabel('Title').fill('Portable recovery');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('autosave-status')).toContainText('kept on this device', { timeout: 5000 });
    await page.close();
    const next = await context.newPage();
    await pickers(next, asPicker('unused.flux', new Uint8Array()));
    await next.goto('/');
    const prompt = next.getByRole('dialog', { name: 'Recover unsaved changes' });
    await expect(prompt).toContainText('Portable recovery');
    await prompt.getByRole('button', { name: 'Recover' }).click();
    await new EditorPage(next).screens.first().waitFor();
    if (!legacy) await expect(new EditorPage(next).screens.first().locator('.fx-artwork')).toHaveCount(1);
    await next.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await writes(next)).length).toBe(1);
    if (legacy) await expect(next.getByRole('status').filter({ hasText: 'legacy:missing' })).toContainText('Saved');
    else {
      const data = await savedShapeData((await writes(next))[0]?.bytes ?? new Uint8Array());
      expect(data.ids).toEqual(['sample:box']);
      expect(data.opaque).toBe(true);
      expect(data.bytes).toEqual([0, 255, 1]);
    }
  });
}
