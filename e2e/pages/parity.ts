import type { Page } from '@playwright/test';
import { expect } from '../test.js';
import type { EditorPage } from './editor.js';
import { type Pixels, pixels } from './image-diff.js';

// Drawing a screen to pixels, in the file's player and in the studio's present-in-place, for the specs that compare the two.

/** The screen on show, as pixels. */
export async function shot(page: Page): Promise<Pixels> {
  const screen = page.locator('.fx-screen').first();
  await expect(screen).toBeVisible();
  return pixels(page, await screen.screenshot({ animations: 'disabled' }));
}

/** Every screen of the deck on `page`, one arrow key apart, starting from the first. */
export async function everyScreen(page: Page, count: number): Promise<Pixels[]> {
  const all: Pixels[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await page.keyboard.press('ArrowRight');
    all.push(await shot(page));
  }
  return all;
}

/** Screen `index` of the open document presented in place (shift+F5 presents the current one), then back to the editor (F5). */
export async function presented(page: Page, editor: EditorPage, index: number): Promise<Pixels> {
  await editor.panel('Screens, library and layers').locator('.fx-chrome-screen-button').nth(index).click();
  await page.keyboard.press('Shift+F5');
  await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'present');
  const stage = page.getByTestId('present-in-place').locator('.fx-screen');
  await expect(stage).toHaveCount(1);
  const drawn = await pixels(page, await stage.screenshot({ animations: 'disabled' }));
  await page.keyboard.press('F5');
  await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'edit');
  return drawn;
}
