import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { savedShapeData } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

// a library pick and the toolbar: desktop input
test.describe('pack credits', { tag: '@desktop' }, () => {
  test('NFR-LIC-003, FR-LIB-009: a used pack is credited in the studio, the save pins only its applicable credits, and the offline player shows them', async ({
    page,
    context,
    blocked,
    expectAccessible,
  }) => {
    await pickers(page, asPicker('unused.flux', new Uint8Array()));
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    const editor = new EditorPage(page);
    await editor.open('new');
    // nothing from a pack yet
    await editor.toolbarButton('Credits').click();
    const dialog = page.getByRole('dialog', { name: 'Shape credits' });
    await expect(dialog).toContainText('This document uses no shapes from a shape pack.');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    // the Lucide database icon, picked from the library: Lucide's own credit and the Feather credit that covers it
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('database');
    await left.locator('[data-def-id="lucide:database"]').getByRole('button').click();
    await expect(left.locator('[data-def-id="lucide:database"] svg path').first()).toBeVisible();
    await editor.toolbarButton('Credits').click();
    const lucide = dialog.getByRole('region', { name: 'Lucide icons' });
    await expect(lucide).toContainText('Lucide Icons and Contributors. Licence: ISC');
    await expect(lucide).toContainText('Cole Bemis (Feather). Licence: MIT. Applies to 1 shape');
    await expect(lucide.locator('[part="credit-notice"]').first()).toContainText('ISC License');
    // an inert reference is text, not a link
    await expect(lucide.getByRole('link')).toHaveCount(0);
    await expectAccessible();
    // the dialog keeps its keys: with the picked icon selected, the arrows, Delete, undo, cut and paste leave the document as it was
    const icon = () =>
      page.evaluate(() =>
        JSON.stringify(
          Object.values((window as unknown as { __fluxion: { records(): Record<string, Record<string, unknown>> } }).__fluxion.records()).filter(
            (r) => r['defId'] === 'lucide:database',
          ),
        ),
      );
    const before = await icon();
    expect(JSON.parse(before)).toHaveLength(1);
    for (const key of ['ArrowDown', 'ArrowRight', 'Delete', 'Backspace', 'ControlOrMeta+z', 'ControlOrMeta+x', 'ControlOrMeta+v'])
      await page.keyboard.press(key);
    await expect(dialog).toBeVisible();
    expect(await icon()).toBe(before);
    // Tab stays in the dialog
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(editor.toolbarButton('Credits')).toBeFocused();
    // the save pins the credits that apply to what is used
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
    const data = await savedShapeData(saved);
    expect(data.ids).toEqual(['lucide:database']);
    // sorted by id, as the save keeps them (ADR-0050)
    expect(data.credits).toEqual([
      expect.objectContaining({ id: 'feather', license: 'MIT', definitionIds: ['lucide:database'] }),
      expect.objectContaining({ id: 'lucide', license: 'ISC' }),
    ]);
    // the one-file player, offline, reads them from the file
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-pack-credits-'));
    const offline = await context.newPage();
    try {
      const file = join(dir, 'credits.flux.html');
      writeFileSync(file, await fluxHtmlOfFlux(saved, 'Pack credits'));
      await offline.goto(pathToFileURL(file).href);
      await offline.getByRole('button', { name: 'Credits' }).click();
      const panel = offline.getByRole('dialog', { name: 'Credits' });
      await expect(panel).toContainText('Lucide Icons and Contributors. Licence: ISC');
      await expect(panel).toContainText('Cole Bemis (Feather). Licence: MIT. Applies to 1 shape');
      await offline.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    } finally {
      await offline.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(blocked).toEqual([]);
  });
});
