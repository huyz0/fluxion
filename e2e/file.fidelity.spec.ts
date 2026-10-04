import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { diffPct, PARITY_MAX_DIFF_PCT, type Pixels } from './pages/image-diff.js';
import { everyScreen, presented } from './pages/parity.js';
import { expect, test } from './test.js';

// FR-FIL-001: the file is the document. The 20-screen document is opened in the studio and saved from it (so the file carries what the studio
// embeds: the fonts its text uses), the studio presents it in place, and the `.flux.html` made from that saved file, opened from file://, draws the
// same pixels on every screen, within the bound edit-versus-present parity uses.
const SCREENS = 20;
/** The other fixtures the studio opens, whatever their screen counts: each must draw the same in the file as in the studio. */
const FIXTURES = ['minimal', 'two-rects-line', 'shapes-gallery', 'rich-text'] as const;

/** The studio opens doc20 from the picker and saves a copy of it; then each screen is presented in place: the saved bytes and the pixels of each. */
async function inTheStudio(page: Page, fixture: string, count?: number): Promise<{ saved: Uint8Array; screens: Pixels[] }> {
  await pickers(page, asPicker(`${fixture}.flux`, await fluxFileOf(fixture)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  const editor = new EditorPage(page);
  await editor.screens.first().waitFor();
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
  const screens: Pixels[] = [];
  const total = count ?? (await editor.panel('Screens, library and layers').locator('.fx-chrome-screen-button').count());
  for (let i = 0; i < total; i++) screens.push(await presented(page, editor, i));
  return { saved, screens };
}

test.describe('the studio and the .flux.html draw the same screens', { tag: '@desktop' }, () => {
  let dir = '';
  test.beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-fidelity-'));
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-FIL-001: every screen of the 20-screen document is within 0.1 percent of the studio render', async ({ page, context }) => {
    // forty screenshots and a pixel comparison of each take longer than the default
    test.setTimeout(180_000);
    expect(PARITY_MAX_DIFF_PCT).toBe(0.1);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const studio = await inTheStudio(page, 'doc20', SCREENS);
    const file = join(dir, 'doc20.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(studio.saved, 'Twenty screens'), 'utf8');
    const filePage = await context.newPage();
    await filePage.setViewportSize({ width: 1920, height: 1080 });
    await filePage.goto(pathToFileURL(file).href);
    await filePage.locator('.fx-screen').first().waitFor();
    const drawn = await everyScreen(filePage, SCREENS);
    for (const [i, theirs] of drawn.entries()) {
      const pct = diffPct(studio.screens[i] as Pixels, theirs);
      expect(pct, `screen ${i + 1}: ${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
    }
  });

  for (const fixture of FIXTURES) {
    test(`FR-FIL-006: every screen of the ${fixture} fixture, opened in the studio, is within 0.1 percent of its .flux.html`, async ({ page, context }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1920, height: 1080 });
      const studio = await inTheStudio(page, fixture);
      expect(studio.screens.length).toBeGreaterThan(0);
      const file = join(dir, `${fixture}.flux.html`);
      writeFileSync(file, await fluxHtmlOfFlux(studio.saved, fixture), 'utf8');
      const filePage = await context.newPage();
      await filePage.setViewportSize({ width: 1920, height: 1080 });
      await filePage.goto(pathToFileURL(file).href);
      await filePage.locator('.fx-screen').first().waitFor();
      const drawn = await everyScreen(filePage, studio.screens.length);
      for (const [i, theirs] of drawn.entries()) {
        const pct = diffPct(studio.screens[i] as Pixels, theirs);
        expect(pct, `${fixture} screen ${i + 1}: ${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
      }
    });
  }
});
