import { joinedPair, routeType } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { expect, test } from './test.js';

/** The drawing commands of the connector's decoration strokes (`data-part`): none for a plain route, many for a wave. */
async function commands(editor: EditorPage): Promise<number> {
  const parts = await editor.canvas.locator('.fx-el[data-kind="connector"] [data-part]').evaluateAll((els) => els.map((el) => el.getAttribute('d') ?? ''));
  return parts.reduce((n, d) => n + (d.match(/[MLCQAZ]/gi)?.length ?? 0), 0);
}

// a mouse drag draws the pair: desktop input; every desktop engine (M18.233)
test.describe('pack connector types', { tag: '@desktop' }, () => {
  test('FR-CON-010, FR-LIB-009: arrows:wavy is offered before any save, is drawn as a wave, and is drawn again after save and reopen', async ({
    page,
    context,
  }) => {
    // the studio's in-memory file pickers on every engine, so the save is read back the same way everywhere
    await pickers(page, asPicker('unused.flux', new Uint8Array()));
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    expect(await commands(editor)).toBe(0);
    // the first-party arrows pack's types are in the Route field of a document never saved
    const route = editor.panel('Inspector').getByRole('combobox', { name: 'Route' });
    await expect(route.locator('option[value="arrows:wavy"]')).toHaveCount(1);
    await routeType(editor, 'arrows:wavy');
    await expect(route).toHaveValue('arrows:wavy');
    await expect.poll(() => commands(editor)).toBeGreaterThan(10);
    const wave = await commands(editor);
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
    // the save embeds the pack's definitions beside the document, so it opens where the pack is not installed
    expect(Buffer.from(saved).includes('connectors/arrows.json')).toBe(true);
    const reopened = await context.newPage();
    await pickers(reopened, asPicker('wavy.flux', saved));
    await reopened.goto('/');
    await reopened.getByRole('button', { name: 'Open a file…' }).click();
    const again = new EditorPage(reopened);
    await again.screens.first().waitFor();
    await expect(again.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    await expect.poll(() => commands(again)).toBe(wave);
  });
});
