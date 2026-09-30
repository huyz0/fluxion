import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** A small seeded generator (mulberry32), so the "random" input is the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// keys an editor would act on: tools, nudges, deletes, undo, redo, select all, duplicate
const KEYS = [
  'v',
  'h',
  'r',
  't',
  'f',
  'c',
  'p',
  'd',
  'i',
  'l',
  'ArrowLeft',
  'Shift+ArrowUp',
  'Delete',
  'Backspace',
  'Control+z',
  'Control+Shift+z',
  'Control+a',
  'Control+d',
  'Enter',
  'Space',
];

/** One random input inside `box`: a move, a click, a drag or a key. */
async function randomInput(page: Page, box: { x: number; y: number; width: number; height: number }, next: () => number): Promise<void> {
  const x = box.x + next() * box.width;
  const y = box.y + next() * box.height;
  const roll = next();
  if (roll < 0.4) return page.mouse.move(x, y, { steps: 2 });
  if (roll < 0.6) return page.mouse.click(x, y);
  if (roll >= 0.75) return page.keyboard.press(KEYS[Math.floor(next() * KEYS.length)] as string);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
}

// mouse and keyboard: desktop input
test.describe('present in place', { tag: '@desktop' }, () => {
  test('FR-EDT-009: F5 presents in place and Esc returns; input while presenting never changes the document', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const root = page.getByTestId('editor-root');
    await expect(root).toHaveAttribute('data-mode', 'edit');
    const revision = await root.getAttribute('data-revision');
    // every element and its placement (generated ids differ between mounts, so not the raw markup)
    const drawn = () => editor.elements.evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset['elId']} ${e.getAttribute('style')}`));
    const content = await drawn();
    await page.keyboard.press('F5');
    await expect(root).toHaveAttribute('data-mode', 'present');
    const stage = page.getByTestId('present-in-place');
    await expect(stage.locator('.fx-screen')).toHaveCount(1);
    // random pointer and key input, seeded
    const box = await stage.boundingBox();
    if (box === null) throw new Error('the stage is not laid out');
    const next = random(9);
    for (let i = 0; i < 60; i++) await randomInput(page, box, next);
    await expect(root).toHaveAttribute('data-mode', 'present');
    await page.keyboard.press('Escape');
    await expect(root).toHaveAttribute('data-mode', 'edit');
    // nothing was written: no transaction committed, the screen drawn as before
    await expect(root).toHaveAttribute('data-revision', revision ?? '');
    expect(await drawn()).toEqual(content);
    // shift+F5 presents too; F5 returns
    await page.keyboard.press('Shift+F5');
    await expect(root).toHaveAttribute('data-mode', 'present');
    await page.keyboard.press('F5');
    await expect(root).toHaveAttribute('data-mode', 'edit');
    // and the toolbar's Present button
    await editor.toolbarButton('Present').click();
    await expect(root).toHaveAttribute('data-mode', 'present');
  });

  test('FR-EDT-003: while presenting, the pointer draws the laser trail and no edit chrome', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const root = page.getByTestId('editor-root');
    const revision = await root.getAttribute('data-revision');
    // an element selected in edit: its frame must not follow into present mode
    const c = await editor.canvasCentre();
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press('F5');
    const stage = page.getByTestId('present-in-place');
    await expect(stage).toBeVisible();
    const box = await stage.boundingBox();
    if (box === null) throw new Error('the stage is not laid out');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
    await expect(stage.locator('.fx-screen svg.fx-laser circle').first()).toBeAttached();
    // the trail stays drawn while the pointer keeps moving, past the first fade: the newest dot shows
    await page.waitForTimeout(1200);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6, { steps: 3 });
    const newest = stage.locator('.fx-screen svg.fx-laser circle').last();
    expect(await newest.evaluate((c) => Number(getComputedStyle(c).opacity))).toBeGreaterThan(0.3);
    // no edit chrome: no overlay, selection frame, handles, hover, toolbar or panels
    await expect(page.locator('[class*="fx-chrome"]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-revision', revision ?? '');
  });
});
