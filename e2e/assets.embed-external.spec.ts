import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxWithExternalImage, imageAssetsOf, solidPng } from './pages/flux-files.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { expect, test } from './test.js';

const URL_OF_IMAGE = 'https://assets.fluxion.test/pic.png';

// FR-AST-006: a file whose image lives at a URL is saved with the bytes inside, and the `.flux.html` made from that copy draws the image with
// the network blocked.
test.describe('embedding external assets on save', { tag: '@desktop' }, () => {
  let dir = '';
  test.beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-embed-external-'));
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-AST-006: Save fetches the external image, writes its bytes into the file, and the .flux.html draws it with the network blocked', async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => localStorage.setItem('fluxion.embedExternalAssets', 'true'));
    const png = solidPng(40, 30);
    let fetched = 0;
    await page.route(URL_OF_IMAGE, (route) => {
      fetched += 1;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(png) });
    });
    await pickers(page, asPicker('external.flux', await fluxWithExternalImage(URL_OF_IMAGE)));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
    expect(fetched).toBeGreaterThan(0);
    expect(await imageAssetsOf(saved)).toMatchObject([{ w: 40, h: 30, mime: 'image/png', embedded: true }]);

    // the file made from the copy draws the image with every request to the network refused
    const file = join(dir, 'external.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(saved, 'External image'), 'utf8');
    const offline = await context.newPage();
    const requested: string[] = [];
    offline.on('request', (r) => requested.push(r.url()));
    await offline.route(/^https?:/, (route) => route.abort());
    await offline.goto(pathToFileURL(file).href);
    await offline.locator('.fx-screen').first().waitFor();
    await expect
      .poll(() =>
        offline.evaluate(() =>
          [...document.querySelectorAll('.fx-screen img, .fx-screen image')].some(
            (el) => (el as HTMLImageElement).naturalWidth > 0 || el.getAttribute('href')?.startsWith('data:') || el.getAttribute('href')?.startsWith('blob:'),
          ),
        ),
      )
      .toBe(true);
    expect(requested.filter((u) => u.startsWith('http'))).toEqual([]);
  });

  test('FR-AST-006: an image that cannot be fetched stays external, the save still writes, and says so', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('fluxion.embedExternalAssets', 'true'));
    await page.route(URL_OF_IMAGE, (route) => route.abort());
    await pickers(page, asPicker('external.flux', await fluxWithExternalImage(URL_OF_IMAGE)));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    const bar = page.getByRole('group', { name: 'File' });
    await bar.getByRole('button', { name: 'Save a copy' }).click();
    await expect(bar.getByRole('status')).toContainText('1 external images could not be embedded');
    expect(await imageAssetsOf((await writes(page))[0]?.bytes ?? new Uint8Array())).toMatchObject([{ embedded: false }]);
  });

  test('FR-AST-006: embedding is off until the person turns it on: a save makes no request to the image', async ({ page }) => {
    let fetched = 0;
    await page.route(URL_OF_IMAGE, (route) => {
      fetched += 1;
      return route.abort();
    });
    await pickers(page, asPicker('external.flux', await fluxWithExternalImage(URL_OF_IMAGE)));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    expect(fetched).toBe(0);
  });
});
