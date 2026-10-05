import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-PRS-006: the one-file player draws a progress bar, a screen counter and a controls bar; the controls hide when the pointer and the keys have been idle
// (driven by the page clock) and return on a move. The states are read as the accessibility tree, which is the same in every engine.
test.describe('the chrome of the player', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-chrome-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Chrome' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const controls = (page: Page) => page.getByRole('toolbar', { name: 'Presentation controls' });
  const counter = (page: Page) => page.getByTestId('deck-counter');
  const progress = (page: Page) => page.getByRole('progressbar', { name: 'Progress' });
  async function open(page: Page): Promise<void> {
    await page.clock.install();
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
  }

  test('FR-PRS-006: the controls bar, the counter and the progress bar as the first screen shows them', async ({ page }) => {
    await open(page);
    await expect(controls(page)).toMatchAriaSnapshot(`
      - toolbar "Presentation controls":
        - button "Previous screen"
        - button "Next screen"
        - button "Overview of the screens"
        - button "Full screen"
    `);
    await expect(counter(page)).toHaveText('1 / 20');
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '1');
    await expect(progress(page)).toHaveAttribute('aria-valuemax', '20');
  });

  test('FR-PRS-006: the controls move the deck, and the counter and progress bar follow', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Next screen' }).click();
    await page.getByRole('button', { name: 'Next screen' }).click();
    await expect(page.getByTestId('player-deck')).toHaveAttribute('data-screen-index', '2');
    await expect(counter(page)).toHaveText('3 / 20');
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '3');
    await page.getByRole('button', { name: 'Previous screen' }).click();
    await expect(counter(page)).toHaveText('2 / 20');
    // the deck keys work right after a click on a control
    await page.keyboard.press('ArrowRight');
    await expect(counter(page)).toHaveText('3 / 20');
    await page.getByRole('button', { name: 'Overview of the screens' }).click();
    await expect(page.getByRole('dialog', { name: 'Screen overview' })).toBeVisible();
  });

  test('FR-PRS-006: the controls hide after the idle time and come back on a pointer move; the progress bar stays', async ({ page }) => {
    await open(page);
    await expect(controls(page)).toBeVisible();
    await page.clock.fastForward(2500);
    await expect(controls(page)).toBeVisible();
    await page.clock.fastForward(1000);
    await expect(controls(page)).toBeHidden();
    await expect(page.getByTestId('deck-chrome').locator('[part="controls"]')).toHaveAttribute('data-visible', 'false');
    // the progress bar and the counter stay
    await expect(progress(page)).toBeVisible();
    await expect(counter(page)).toBeVisible();
    await page.mouse.move(200, 200);
    await expect(controls(page)).toBeVisible();
    // a key restarts the wait: just under the time later they are still there
    await page.clock.fastForward(2500);
    await page.keyboard.press('Shift');
    await page.clock.fastForward(2500);
    await expect(controls(page)).toBeVisible();
    await page.clock.fastForward(1000);
    await expect(controls(page)).toBeHidden();
  });
});
