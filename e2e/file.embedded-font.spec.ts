import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { openFonts, robotoBytes, selectedText, textFamily } from './pages/fonts.js';
import { diffPct, PARITY_MAX_DIFF_PCT } from './pages/image-diff.js';
import { everyScreen, presented } from './pages/parity.js';
import { expect, test } from './test.js';

// FR-THM-008, FR-FIL-002: a font the author uploaded travels inside the file. The `.flux.html` made from the saved copy, opened from file:// with
// nothing fetched, draws the text in that font, and the screen is the same pixels as the studio's (so the text measured the same).
test.describe('an uploaded font in the .flux.html', { tag: '@desktop' }, () => {
  test.setTimeout(180_000);
  let dir = '';
  test.beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-embedded-font-'));
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-THM-008: the file draws the uploaded font offline, in the studio’s pixels', async ({ page, context }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await pickers(page, asPicker('unused.flux', new Uint8Array()));
    const editor = new EditorPage(page);
    await selectedText(page, editor, dragOut);
    await openFonts(editor);
    const dialog = page.getByRole('dialog', { name: 'Fonts' });
    await dialog.getByRole('tab', { name: 'Upload' }).click();
    await dialog.getByLabel('Font file').setInputFiles({ name: 'Fx-Mine.woff2', mimeType: 'font/woff2', buffer: robotoBytes(700) });
    await expect(dialog.getByRole('status')).toContainText('Fx Mine applied to the selection', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => textFamily(editor)).toContain('Fx Mine');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
    const studio = await presented(page, editor, 0);

    const file = join(dir, 'font.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(saved, 'Embedded font'), 'utf8');
    const filePage = await context.newPage();
    const requested: string[] = [];
    filePage.on('request', (r) => requested.push(r.url()));
    await filePage.setViewportSize({ width: 1920, height: 1080 });
    await filePage.goto(pathToFileURL(file).href);
    await filePage.locator('.fx-screen').first().waitFor();
    // the face came out of the file's own bytes, and the text is drawn in it
    await expect
      .poll(() => filePage.evaluate(() => [...document.fonts].some((f) => f.family.replaceAll('"', '') === 'Fx Mine' && f.status === 'loaded')))
      .toBe(true);
    expect(
      await filePage
        .locator('.fx-label')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain('Fx Mine');
    const [drawn] = await everyScreen(filePage, 1);
    const pct = diffPct(studio, drawn ?? studio);
    expect(pct, `${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
    // nothing was fetched beyond the file itself (data: URLs and blobs are the page's own)
    expect(requested.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  });
});
