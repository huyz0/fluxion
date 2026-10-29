import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { importedArtworkFontFile } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

// FR-LIB-004 FR-AST-003 NFR-LIC-003: imported SVG text saved with its exact font (M18.81) reopens offline in the studio and in the
// one-file player, drawn under the font's private alias from the retained bytes; the document's ordinary Inter text keeps its own
// face (the collision case). The network is blocked for the whole context (test.ts), so nothing can come from elsewhere.

/** The statuses of the page's faces under `family`. */
const faces = (page: Page, family: string) =>
  page.evaluate((name) => [...document.fonts].filter((face) => face.family.replaceAll('"', '') === name).map((face) => face.status), family);
/** The computed family of the first node `locator` matches. */
const familyOf = (locator: Locator) => locator.first().evaluate((node) => getComputedStyle(node).fontFamily.replaceAll('"', ''));

test.describe('imported artwork keeps its exact font offline (M18.81)', { tag: '@desktop' }, () => {
  test('FR-LIB-004 FR-AST-003: the studio draws imported text in the retained face, and ordinary Inter text keeps its own', async ({ page, blocked }) => {
    const file = await importedArtworkFontFile();
    const alias = `fx-artwork-${file.sha256}`;
    await pickers(page, asPicker('imported.flux', file.bytes));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    const editor = new EditorPage(page);
    await editor.screens.first().waitFor();
    await expect(editor.screens.first().locator('.fx-artwork text')).toHaveText('API');
    expect(await familyOf(page.locator('.fx-artwork text'))).toBe(alias);
    await expect.poll(() => faces(page, alias)).toEqual(['loaded']);
    // the ordinary text keeps the family the document names; the artwork's bytes never take that name
    await expect(editor.screens.first().getByText('Ordinary Inter')).toBeVisible();
    // drawn in the document's own Inter, never the alias
    expect(await familyOf(editor.screens.first().locator('[data-kind="text"] p'))).toMatch(/^Inter,/);
    expect(await faces(page, 'Inter')).not.toContain('error');
    expect(blocked).toEqual([]);
  });

  test('FR-LIB-004 FR-AST-003: the same file as a .flux.html from file:// draws the text in the retained face with no request', async ({ page, blocked }) => {
    const file = await importedArtworkFontFile();
    const alias = `fx-artwork-${file.sha256}`;
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-font-retention-'));
    try {
      const path = join(dir, 'imported.flux.html');
      writeFileSync(path, await fluxHtmlOfFlux(file.bytes, 'Imported'), 'utf8');
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      await page.goto(pathToFileURL(path).href);
      await expect(page.locator('.fx-artwork text')).toHaveText('API');
      expect(await familyOf(page.locator('.fx-artwork text'))).toBe(alias);
      await expect.poll(() => faces(page, alias)).toEqual(['loaded']);
      await expect(page.getByText('Ordinary Inter')).toBeVisible();
      expect(await familyOf(page.locator('[data-kind="text"] p'))).toMatch(/^Inter,/);
      expect(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
