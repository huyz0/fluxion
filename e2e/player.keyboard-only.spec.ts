import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-A11Y-004: the whole presentation without a pointer. Nothing in this file touches the mouse or taps: the screens are walked with the keys, the controls are reached
// with Tab and pressed with Enter or Space, and the overview grid traps focus while it is open and gives it back when it closes.
test.describe('presenting with the keyboard alone', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-keys-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Keyboard only' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const counter = (page: Page) => page.getByTestId('deck-counter');
  const button = (page: Page, name: string) => page.getByRole('button', { name });
  async function open(page: Page): Promise<void> {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
  }

  test('NFR-A11Y-004: every screen is reached with the arrow keys, forward and back, with Home and End at the ends', async ({ page }) => {
    await open(page);
    await expect(counter(page)).toHaveText('1 / 20');
    for (let n = 2; n <= 20; n++) {
      await page.keyboard.press('ArrowRight');
      await expect(counter(page)).toHaveText(`${n} / 20`);
    }
    // the last screen holds
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText('20 / 20');
    for (let n = 19; n >= 1; n--) {
      await page.keyboard.press('ArrowLeft');
      await expect(counter(page)).toHaveText(`${n} / 20`);
    }
    await page.keyboard.press('End');
    await expect(counter(page)).toHaveText('20 / 20');
    await page.keyboard.press('Home');
    await expect(counter(page)).toHaveText('1 / 20');
  });

  test('NFR-A11Y-004: the controls are reached with Tab in order and pressed with Enter and Space, and the deck keys work again after them', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('Tab');
    await expect(button(page, 'Previous screen')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button(page, 'Next screen')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(counter(page)).toHaveText('2 / 20');
    // a press keeps the focus on the button, so Space presses it again
    await expect(button(page, 'Next screen')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(counter(page)).toHaveText('3 / 20');
    await page.keyboard.press('Shift+Tab');
    await expect(button(page, 'Previous screen')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(counter(page)).toHaveText('2 / 20');
    // the arrow keys still move the deck while a control has focus
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText('3 / 20');
  });

  test('NFR-A11Y-004: the overview opens from its button, keeps focus inside while open, picks a screen with Enter and gives focus back', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(button(page, 'Overview of the screens')).toBeFocused();
    await page.keyboard.press('Enter');
    const grid = page.getByRole('dialog', { name: 'Screen overview' });
    await expect(grid).toBeVisible();
    // focus starts on the current screen's thumbnail and Tab goes round the thumbnails without leaving the dialog
    await expect(grid.getByRole('button', { name: /^Screen 1(:|$)/ })).toBeFocused();
    for (let n = 0; n < 25; n++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    }
    // the arrow keys move between thumbnails, Enter picks one
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(grid.getByRole('button', { name: /^Screen 3(:|$)/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(grid).toBeHidden();
    await expect(counter(page)).toHaveText('3 / 20');
    await expect(button(page, 'Overview of the screens')).toBeFocused();
    // Escape closes it too, and focus is back on the button again
    await page.keyboard.press('Enter');
    await expect(grid).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(grid).toBeHidden();
    await expect(counter(page)).toHaveText('3 / 20');
    await expect(button(page, 'Overview of the screens')).toBeFocused();
  });
});
