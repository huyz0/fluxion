import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './test.js';

// FR-FIL-002, FR-PRS-001, NFR-A11Y-002, NFR-A11Y-004: the committed demo, `examples/r1-mvp-deck.flux.html`, opened as a person opens it, from `file://`, with every
// request to a non-local host blocked (the fixture in test.ts), then checked with axe and walked with the keyboard alone.
const URL_OF_DEMO = pathToFileURL(resolve('examples/r1-mvp-deck.flux.html')).href;
const SCREENS = 5;

test.describe('the R1 demo, offline', { tag: '@desktop' }, () => {
  async function open(page: Page): Promise<void> {
    await page.goto(URL_OF_DEMO);
    await page.locator('.fx-screen').first().waitFor();
  }
  const counter = (page: Page) => page.getByTestId('deck-counter');

  test('FR-FIL-002: the demo opens from file:// offline, draws its first screen and asks nothing of the network', async ({ page, blocked }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page);
    await expect(counter(page)).toHaveText(`1 / ${SCREENS}`);
    await expect(page.locator('.fx-screen').first()).toContainText('Welcome to Fluxion');
    expect(blocked).toEqual([]);
    expect(requests.every((url) => url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:'))).toBe(true);
  });

  test('NFR-A11Y-002: axe finds nothing serious or critical on the demo, and every move is announced', async ({ page, expectAccessible }) => {
    await open(page);
    await expectAccessible();
    const live = page.getByRole('status').filter({ hasText: /^Screen \d+ of 5/ });
    await expect(live).toHaveText(/^Screen 1 of 5: Welcome/);
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(/^Screen 2 of 5: Draw/);
    await expectAccessible();
  });

  test('NFR-A11Y-004: the demo is presented from the first screen to the last with the keyboard alone, the controls reached with Tab', async ({ page }) => {
    await open(page);
    for (let n = 2; n <= SCREENS; n++) {
      await page.keyboard.press('ArrowRight');
      await expect(counter(page)).toHaveText(`${n} / ${SCREENS}`);
    }
    await page.keyboard.press('Home');
    await expect(counter(page)).toHaveText(`1 / ${SCREENS}`);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Previous screen' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(counter(page)).toHaveText(`2 / ${SCREENS}`);
    await page.keyboard.press('End');
    await expect(counter(page)).toHaveText(`${SCREENS} / ${SCREENS}`);
  });
});
