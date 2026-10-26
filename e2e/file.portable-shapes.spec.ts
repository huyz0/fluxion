import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { fluxHtmlOfFlux } from './pages/flux-html.js';
import { diffPct, PARITY_MAX_DIFF_PCT, pixels } from './pages/image-diff.js';
import { portableShapeFile, savedShapeData } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

async function markup(page: Page): Promise<string> {
  return page
    .locator('.fx-artwork')
    .first()
    .evaluate((element) => {
      let text = element.outerHTML;
      [...element.querySelectorAll('[id]')].forEach((node, i) => {
        text = text.split(node.id).join(`PAINT${i}`);
      });
      return text;
    });
}

test('FR-LIB-009 NFR-A11Y-001: portable artwork opens, saves and renders in Studio and the offline inline player', async ({
  page,
  context,
  blocked,
  expectAccessible,
}, info) => {
  const mobile = info.project.name.startsWith('mobile');
  if (!mobile) await page.setViewportSize({ width: 2200, height: 1400 });
  await pickers(page, asPicker('shapes.flux', await portableShapeFile()));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  const editor = new EditorPage(page);
  await editor.screens.first().waitFor();
  await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);
  const original = await markup(page);
  expect(original).toContain('linearGradient');
  expect(original).toContain('clipPath');
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
  const data = await savedShapeData(saved);
  expect(data.ids).toEqual(['sample:box']);
  expect(data.credits.length).toBeGreaterThan(0);
  expect(data.opaque).toBe(true);
  expect(data.bytes).toEqual([0, 255, 1]);
  if (!mobile) {
    const focus = editor.toolbarButton('Focus mode');
    if ((await focus.getAttribute('aria-pressed')) !== 'true') await focus.click();
    await expect.poll(async () => (await editor.canvas.boundingBox())?.width).toBe(2200);
    // ResizeObserver and Canvas.onBox publish through separate React commits.
    // Let those commits settle before issuing either zoom action once.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await editor.zoomButton('Fit').click();
    await expect
      .poll(async () => {
        const box = await editor.screens.first().boundingBox();
        return box && { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      })
      .toEqual({ x: 1100, y: 720 });
    await editor.zoomButton('100 %').click();
    await expect(editor.zoomValue).toHaveText('100 %');
    await page.mouse.move(0, 0);
    await expect.poll(() => editor.screens.first().boundingBox()).toEqual({ x: 140, y: 180, width: 1920, height: 1080 });
  }
  const edit = await page.locator('.fx-artwork').first().screenshot({ animations: 'disabled' });
  await expectAccessible();
  if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('F5');
  await expect(page.getByTestId('present-in-place').locator('.fx-artwork')).toHaveCount(1);
  expect(await markup(page)).toBe(original);
  const present = await page.locator('.fx-artwork').first().screenshot({ animations: 'disabled' });
  if (!mobile) expect(diffPct(await pixels(page, edit), await pixels(page, present))).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
  await expectAccessible();
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-portable-shapes-'));
  const inline = await context.newPage();
  try {
    const file = join(dir, 'shapes.flux.html');
    writeFileSync(file, await fluxHtmlOfFlux(saved, 'Portable artwork'));
    if (!mobile) await inline.setViewportSize({ width: 1920, height: 1080 });
    await inline.goto(pathToFileURL(file).href);
    await expect(inline.locator('.fx-artwork')).toHaveCount(1);
    expect(await markup(inline)).toBe(original);
    await inline.screenshot({ path: `.harness/artifacts/M18.76/${info.project.name}-inline.png` });
    await info.attach('portable-inline', { body: await inline.screenshot(), contentType: 'image/png' });
  } finally {
    await inline.close();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(blocked).toEqual([]);
});

test('FR-LIB-009: Save reports unavailable legacy geometry instead of claiming a fully portable document', async ({ page }) => {
  await pickers(page, asPicker('legacy.flux', await portableShapeFile(true)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  const editor = new EditorPage(page);
  await editor.screens.first().waitFor();
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'legacy:missing' })).toContainText('Saved');
  expect(await writes(page)).toHaveLength(1);
});
