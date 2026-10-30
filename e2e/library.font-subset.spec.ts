import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fontAssetsOf } from './pages/flux-files.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { mockGoogleFonts, openFonts, robotoBytes, searchGoogle, selectedText } from './pages/fonts.js';
import { diffPct, PARITY_MAX_DIFF_PCT } from './pages/image-diff.js';
import { everyScreen, presented } from './pages/parity.js';
import { expect, test } from './test.js';

// FR-AST-003, ADR-0051, ADR-0201 (M18.40): with "Subset embedded fonts" on, a save writes the catalog font cut to the text it draws, in a
// worker; the .flux.html made from that file draws the same pixels from file:// with nothing fetched. With the option off (the default) the
// font is written whole, byte for byte.
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** A new document whose one text element is drawn in the mocked Google Roboto. */
async function robotoText(page: Page): Promise<EditorPage> {
  await mockGoogleFonts(page, 'Roboto');
  await pickers(page, asPicker('unused.flux', new Uint8Array()));
  const editor = new EditorPage(page);
  await selectedText(page, editor, dragOut);
  await openFonts(editor);
  const dialog = page.getByRole('dialog', { name: 'Fonts' });
  await searchGoogle(dialog, 'Roboto');
  await dialog.getByRole('button', { name: 'Add Roboto', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Roboto applied to the selection', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  return editor;
}

/** Turn the save option on or off in the assistant's settings. */
async function subsetOnSave(page: Page, on: boolean): Promise<void> {
  await page.getByRole('button', { name: 'AI assistant' }).click();
  const box = page.getByRole('complementary', { name: 'AI assistant' }).getByLabel('Subset embedded fonts to the text they draw when saving');
  await box.setChecked(on);
  await page.getByRole('button', { name: 'AI assistant' }).click();
}

/** Save a copy and return its bytes and the line the save shows. */
async function saveCopy(page: Page, count: number): Promise<{ bytes: Uint8Array; said: string }> {
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(count);
  const status = page.getByRole('group', { name: 'File' }).getByRole('status');
  await expect(status).toContainText('Saved');
  return { bytes: (await writes(page))[count - 1]?.bytes ?? new Uint8Array(), said: (await status.textContent()) ?? '' };
}

test.describe('subset fonts on save', { tag: '@desktop' }, () => {
  test.setTimeout(180_000);
  let dir = '';
  test.beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-font-subset-'));
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-AST-003: an enabled save writes validated subsets that draw the studio’s pixels offline', async ({ page, context }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const editor = await robotoText(page);
    await subsetOnSave(page, true);
    const { bytes, said } = await saveCopy(page, 1);
    expect(said).toMatch(/fonts were subset to the text they draw/);
    const fonts = await fontAssetsOf(bytes);
    // every embedded face (Roboto and the bundled Inter) is a subset of exactly its bytes that names the whole font it was cut from
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toMatchObject({ mime: 'font/woff2', held: font.hash, source: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const whole = new Set([sha256(robotoBytes(400)), sha256(robotoBytes(700))]);
    const roboto = fonts.filter((f) => f.name?.startsWith('roboto-'));
    expect(roboto.length).toBeGreaterThan(0);
    for (const font of roboto) expect(whole.has(font.source as string) && !whole.has(font.held as string)).toBe(true);
    const studio = await presented(page, editor, 0);

    const file = join(dir, 'subset.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(bytes, 'Subset font'), 'utf8');
    const filePage = await context.newPage();
    const requested: string[] = [];
    filePage.on('request', (r) => requested.push(r.url()));
    await filePage.setViewportSize({ width: 1920, height: 1080 });
    await filePage.goto(pathToFileURL(file).href);
    await filePage.locator('.fx-screen').first().waitFor();
    await expect
      .poll(() => filePage.evaluate(() => [...document.fonts].some((f) => f.family.replaceAll('"', '') === 'Roboto' && f.status === 'loaded')))
      .toBe(true);
    const [drawn] = await everyScreen(filePage, 1);
    const pct = diffPct(studio, drawn ?? studio);
    expect(pct, `${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
    expect(requested.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  });

  test('FR-AST-003: the default save writes the whole font, byte for byte', async ({ page }) => {
    await robotoText(page);
    const { bytes, said } = await saveCopy(page, 1);
    expect(said).not.toMatch(/subset/);
    const fonts = await fontAssetsOf(bytes);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toMatchObject({ source: undefined, held: font.hash });
    // the Google faces are the very bytes the font host served
    const whole = new Set([sha256(robotoBytes(400)), sha256(robotoBytes(700))]);
    const roboto = fonts.filter((f) => f.name?.startsWith('roboto-'));
    expect(roboto.length).toBeGreaterThan(0);
    for (const font of roboto) expect(whole.has(font.held as string)).toBe(true);
  });
});
