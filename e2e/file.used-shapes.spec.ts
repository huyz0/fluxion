import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { diffPct, PARITY_MAX_DIFF_PCT, pixels } from './pages/image-diff.js';
import { fullDistributionFile, savedShapeData } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

async function content(page: Page) {
  return page
    .locator('.fx-screen .fx-content')
    .first()
    .evaluate((el) => {
      let html = el.outerHTML;
      const ids = [...new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] as string))];
      ids.forEach((id, i) => {
        html = html.split(id).join(`ID${i}`);
      });
      return html;
    });
}

test('FR-LIB-009 NFR-LIC-003 NFR-A11Y-001: three of 5000 definitions render identically after real host save and offline reopen', async ({
  page,
  context,
  blocked,
  expectAccessible,
}, info) => {
  const mobile = info.project.name.startsWith('mobile');
  const original = await fullDistributionFile();
  expect((await savedShapeData(original)).ids).toHaveLength(5000);
  if (!mobile) await page.setViewportSize({ width: 2200, height: 1400 });
  await pickers(page, asPicker('full-pack.flux', original));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  const editor = new EditorPage(page);
  await editor.screens.first().waitFor();
  await expect(editor.screens.first().locator('.fx-outline')).toHaveCount(3);
  const before = await content(page);
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
  const subset = await savedShapeData(saved);
  expect(subset.ids).toEqual(['portable:s0', 'portable:s23', 'portable:s7']);
  expect(subset.credits).toEqual([
    expect.objectContaining({ id: 'global' }),
    expect.objectContaining({ id: 'scoped', definitionIds: ['portable:s0', 'portable:s7'] }),
  ]);
  if (!mobile) {
    const focus = editor.toolbarButton('Focus mode');
    if ((await focus.getAttribute('aria-pressed')) !== 'true') await focus.click();
    await expect.poll(async () => (await editor.canvas.boundingBox())?.width).toBe(2200);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await editor.zoomButton('Fit').click();
    await editor.zoomButton('100 %').click();
    await page.mouse.move(0, 0);
    await expect.poll(() => editor.screens.first().boundingBox()).toEqual({ x: 140, y: 180, width: 1920, height: 1080 });
  }
  await expectAccessible();
  const edit = await editor.screens.first().screenshot({ animations: 'disabled' });
  if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('F5');
  await expect(page.getByTestId('present-in-place')).toBeVisible();
  expect(await content(page)).toBe(before);
  const present = await page.getByTestId('present-in-place').locator('.fx-screen').screenshot({ animations: 'disabled' });
  if (!mobile) expect(diffPct(await pixels(page, edit), await pixels(page, present))).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-three-shapes-'));
  const offline = await context.newPage();
  try {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (viewport) await offline.setViewportSize(viewport);
    const file = join(dir, 'three.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(saved, 'Three portable shapes'));
    await page.close();
    await offline.goto(pathToFileURL(file).href);
    await expect(offline.locator('.fx-outline')).toHaveCount(3);
    expect(await content(offline)).toBe(before);
    // Compare document pixels, excluding the standalone host's overlapping navigation chrome.
    // This leaves screen styles, geometry and scaling unchanged.
    const reopened = await offline.locator('.fx-screen').first().screenshot({
      animations: 'disabled',
      style: '[data-testid="deck-chrome"] { visibility: hidden; }',
    });
    expect(diffPct(await pixels(offline, present), await pixels(offline, reopened))).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
    await offline.screenshot({ path: `.harness/artifacts/M18.14/${info.project.name}-offline.png` });
  } finally {
    await offline.close();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(blocked).toEqual([]);
});
