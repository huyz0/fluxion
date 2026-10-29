import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// face (the collision case): its `Inter` faces are exactly the host's own, against a baseline without the artwork, and the
// artwork's bytes are constructed once, under the alias only (M18.172). The network is blocked for the whole context (test.ts), so nothing can come from elsewhere.

/** The statuses of the page's faces under `family`. */
const faces = (page: Page, family: string) =>
  page.evaluate((name) => [...document.fonts].filter((face) => face.family.replaceAll('"', '') === name).map((face) => face.status), family);
/**
 * Every face the page constructs through the FontFace API, by family and byte length, recorded from before any page script runs:
 * how the artwork's bytes are registered, and that they never are under `Inter` (M18.172).
 */
const recordConstructedFaces = (page: Page) =>
  page.addInitScript(() => {
    const made: { family: string; bytes: number }[] = [];
    (window as unknown as { __fxFaces: typeof made }).__fxFaces = made;
    const Native = window.FontFace;
    window.FontFace = class extends Native {
      constructor(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
        super(family, source, descriptors);
        made.push({ family: family.replaceAll('"', ''), bytes: typeof source === 'string' ? -1 : source.byteLength });
      }
    };
    // a face taken out of the set is recorded too, so a swap of the host's own Inter cannot pass as an unchanged set
    const remove = document.fonts.delete.bind(document.fonts);
    document.fonts.delete = (face: FontFace) => {
      made.push({ family: `deleted:${face.family.replaceAll('"', '')}`, bytes: 0 });
      return remove(face);
    };
  });
/** The `Inter` faces the page has (descriptors and CSS sources, sorted) and the faces it constructed or deleted: the host's own set, compared with a baseline. */
const interFaces = (page: Page) =>
  page.evaluate(() => ({
    inter: [...document.fonts]
      .filter((face) => face.family.replaceAll('"', '') === 'Inter')
      .map((face) => `${face.weight} ${face.style} ${face.unicodeRange}`)
      .sort(),
    // the sources of every CSS `Inter` face: an injected rule naming other bytes differs from the host's own
    rules: [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
      .filter((rule) => rule.style.getPropertyValue('font-family').replaceAll(/["']/g, '').trim() === 'Inter')
      .map((rule) => rule.style.getPropertyValue('src'))
      .sort(),
    constructed: [...(window as unknown as { __fxFaces: { family: string; bytes: number }[] }).__fxFaces].sort((a, b) =>
      `${a.family} ${a.bytes}`.localeCompare(`${b.family} ${b.bytes}`),
    ),
  }));
type Constructed = { family: string; bytes: number };
/** `baseline`'s constructed faces plus the artwork's one, under its alias with Inter's exact byte length, in the same order. */
const withAlias = (baseline: readonly Constructed[], alias: string): Constructed[] =>
  [...baseline, { family: alias, bytes: INTER_BYTES }].sort((a, b) => `${a.family} ${a.bytes}`.localeCompare(`${b.family} ${b.bytes}`));

/** The studio's faces once `bytes` is opened and its ordinary text drawn, in a page recording constructions from its start. */
async function studioFaces(page: Page, bytes: Uint8Array) {
  await recordConstructedFaces(page);
  await pickers(page, asPicker('baseline.flux', bytes));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  await expect(new EditorPage(page).screens.first().getByText('Ordinary Inter')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return interFaces(page);
}
const INTER_BYTES = readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2').byteLength;

/** The computed family of the first node `locator` matches. */
const familyOf = (locator: Locator) => locator.first().evaluate((node) => getComputedStyle(node).fontFamily.replaceAll('"', ''));

test.describe('imported artwork keeps its exact font offline (M18.81)', { tag: '@desktop' }, () => {
  test('FR-LIB-004 FR-AST-003: the studio draws imported text in the retained face, and ordinary Inter text keeps its own', async ({
    page,
    context,
    blocked,
  }) => {
    const file = await importedArtworkFontFile();
    const alias = `fx-artwork-${file.sha256}`;
    // the host's own faces: the same document without the artwork, opened in a page of its own (M18.172)
    const baselinePage = await context.newPage();
    const baseline = await studioFaces(baselinePage, (await importedArtworkFontFile({ artwork: false })).bytes);
    await baselinePage.close();
    await recordConstructedFaces(page);
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
    // the Inter faces are exactly the host's own, and the artwork's bytes are constructed once, under the alias only (M18.172)
    await page.evaluate(() => document.fonts.ready);
    const opened = await interFaces(page);
    expect(opened.inter).toEqual(baseline.inter);
    expect(opened.rules).toEqual(baseline.rules);
    expect(opened.constructed).toEqual(withAlias(baseline.constructed, alias));
    expect(blocked).toEqual([]);
  });

  test('FR-LIB-004 FR-AST-003: the same file as a .flux.html from file:// draws the text in the retained face with no request', async ({ page, blocked }) => {
    const file = await importedArtworkFontFile();
    const alias = `fx-artwork-${file.sha256}`;
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-font-retention-'));
    try {
      const path = join(dir, 'imported.flux.html');
      writeFileSync(path, await fluxHtmlOfFlux(file.bytes, 'Imported'), 'utf8');
      // the same page without the artwork: the host's own faces (M18.172)
      const baselinePath = join(dir, 'baseline.flux.html');
      writeFileSync(baselinePath, await fluxHtmlOfFlux((await importedArtworkFontFile({ artwork: false })).bytes, 'Imported'), 'utf8');
      await recordConstructedFaces(page);
      await page.goto(pathToFileURL(baselinePath).href);
      await expect(page.getByText('Ordinary Inter')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const baseline = await interFaces(page);
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      await page.goto(pathToFileURL(path).href);
      await expect(page.locator('.fx-artwork text')).toHaveText('API');
      expect(await familyOf(page.locator('.fx-artwork text'))).toBe(alias);
      await expect.poll(() => faces(page, alias)).toEqual(['loaded']);
      await expect(page.getByText('Ordinary Inter')).toBeVisible();
      expect(await familyOf(page.locator('[data-kind="text"] p'))).toMatch(/^Inter,/);
      await page.evaluate(() => document.fonts.ready);
      const opened = await interFaces(page);
      expect(opened.inter).toEqual(baseline.inter);
      expect(opened.rules).toEqual(baseline.rules);
      expect(opened.constructed).toEqual(withAlias(baseline.constructed, alias));
      expect(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
      expect(blocked).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
