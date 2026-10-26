import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { diffPct, PARITY_MAX_DIFF_PCT, pixels } from './pages/image-diff.js';
import { expect, test } from './test.js';

const definition: unknown = JSON.parse(readFileSync('fixtures/artwork/paint.shape.json', 'utf8'));
type Hooks = {
  registerShape(input: unknown): string | undefined;
  records(): Record<string, Record<string, unknown>>;
  applyRecords(puts: readonly object[]): string | undefined;
};
async function prepare(page: Page): Promise<EditorPage> {
  await page.addInitScript(() => {
    Object.assign(window, { __FLUXION_TEST_HOOKS__: true });
  });
  const editor = new EditorPage(page);
  await editor.open('new');
  const error = await page.evaluate((input) => {
    const hooks = (window as unknown as { __fluxion: Hooks }).__fluxion;
    const failure = hooks.registerShape(input);
    if (failure) return failure;
    const screen = Object.values(hooks.records()).find(({ type }) => type === 'screen');
    const { id } = screen ?? {};
    return hooks.applyRecords([
      {
        id: 'ArtworkTest0001',
        type: 'element',
        kind: 'shape',
        screenId: id,
        index: 'a0',
        defId: 'test:artwork',
        transform: { x: 150, y: 150, w: 100, h: 100 },
      },
    ]);
  }, definition);
  expect(error).toBeUndefined();
  await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);
  return editor;
}
async function paintMarkup(page: Page): Promise<string> {
  return page
    .locator('.fx-artwork')
    .first()
    .evaluate((element) => {
      let markup = element.outerHTML;
      [...element.querySelectorAll('[id]')].forEach((node, i) => {
        markup = markup.split(node.id).join(`PAINT${i}`);
      });
      return markup;
    });
}

test('FR-LIB-004 FR-EDT-010 NFR-A11Y-001: imported artwork draws equally in studio edit and presentation', async ({
  page,
  expectAccessible,
  blocked,
}, info) => {
  const mobile = info.project.name.startsWith('mobile');
  if (!mobile) await page.setViewportSize({ width: 2200, height: 1400 });
  const editor = await prepare(page);
  if (!mobile) {
    const focus = editor.toolbarButton('Focus mode');
    if ((await focus.getAttribute('aria-pressed')) !== 'true') await focus.click();
    await expect.poll(async () => (await editor.canvas.boundingBox())?.width).toBe(2200);
    await page.keyboard.press('Shift+Digit1');
    await page.keyboard.press('Shift+Digit0');
    await expect(editor.zoomValue).toHaveText('100 %');
    await page.mouse.move(0, 0);
    await expect.poll(() => editor.screens.first().boundingBox()).toEqual({ x: 140, y: 180, width: 1920, height: 1080 });
  }
  const markup = await paintMarkup(page);
  expect(markup).toContain('linearGradient');
  expect(markup).toContain('clipPath');
  expect(markup).toContain('>A</text>');
  const editBounds = await page.locator('.fx-artwork').first().boundingBox();
  const edit = await page.locator('.fx-artwork').first().screenshot({ animations: 'disabled' });
  await info.attach('artwork-edit', { body: edit, contentType: 'image/png' });
  await expectAccessible();
  if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('F5');
  await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'present');
  await expect(page.getByTestId('present-in-place').locator('.fx-artwork')).toHaveCount(1);
  if (!mobile) {
    await expect.poll(() => page.getByTestId('present-in-place').locator('.fx-screen').boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  }
  expect(await paintMarkup(page)).toBe(markup);
  const presentBounds = await page.locator('.fx-artwork').first().boundingBox();
  await info.attach('artwork-bounds', { body: JSON.stringify({ edit: editBounds, present: presentBounds }), contentType: 'application/json' });
  const presented = await page.locator('.fx-artwork').first().screenshot({ animations: 'disabled' });
  await info.attach('artwork-present', { body: presented, contentType: 'image/png' });
  if (!mobile) {
    const [before, after] = [await pixels(page, edit), await pixels(page, presented)];
    expect({ width: after.w, height: after.h }, 'artwork PNG dimensions: presentation versus edit').toEqual({ width: before.w, height: before.h });
    expect(diffPct(before, after), `artwork paint difference at ${before.w}×${before.h} pixels`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
  }
  await expectAccessible();
  expect(blocked).toEqual([]);
  await page.screenshot({ path: `.harness/artifacts/M18.47/${info.project.name}-artwork.png` });
});
