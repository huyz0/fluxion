import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-PRS-002: the one-file player moves with the keys a presenter and a clicker send, a click, and a typed screen number; a hidden screen is skipped and the
// ends are held. The deck is the one a `.flux.html` runs (the built one-file player), opened from file://, on the 20-screen fixture with one screen hidden.
const HIDDEN_AT = 2;

test.describe('keyboard navigation in the player', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  /** The screens presented, in order: the 20 of the fixture without the hidden one. */
  let shown: string[] = [];
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-keynav-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(
      file,
      await fluxHtmlOf('doc20', {
        title: 'Keys',
        edit: (document) => {
          const screens = Object.values(document.records)
            .filter((r) => r['type'] === 'screen')
            .sort((a, b) => String(a['index']).localeCompare(String(b['index'])) || String(a['id']).localeCompare(String(b['id'])));
          (screens[HIDDEN_AT] as Record<string, unknown>)['hidden'] = true;
          shown = screens.filter((_, i) => i !== HIDDEN_AT).map((s) => String(s['id']));
        },
      }),
      'utf8',
    );
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const deck = (page: Page) => page.getByTestId('player-deck');
  /** Open the deck and wait for its first screen. */
  async function open(page: Page): Promise<void> {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    await expect(deck(page)).toHaveAttribute('data-screen-index', '0');
  }
  /** The screen shown is the `index`-th visible one, drawn. */
  async function at(page: Page, index: number): Promise<void> {
    await expect(deck(page)).toHaveAttribute('data-screen-index', String(index));
    await expect(page.locator('.fx-screen')).toHaveAttribute('data-screen-id', shown[index] as string);
  }

  for (const key of ['ArrowRight', 'ArrowDown', 'Space', 'PageDown', 'Enter']) {
    test(`FR-PRS-002: ${key} goes to the next screen`, async ({ page }) => {
      await open(page);
      await page.keyboard.press(key);
      await at(page, 1);
    });
  }

  for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) {
    test(`FR-PRS-002: ${key} goes back to the previous screen`, async ({ page }) => {
      await open(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await at(page, 2);
      await page.keyboard.press(key);
      await at(page, 1);
    });
  }

  test('FR-PRS-002: Home goes to the first screen and End to the last', async ({ page }) => {
    await open(page);
    await page.keyboard.press('End');
    await at(page, shown.length - 1);
    await page.keyboard.press('Home');
    await at(page, 0);
  });

  test('FR-PRS-002: a click on the screen goes to the next screen', async ({ page }) => {
    await open(page);
    await deck(page).click({ position: { x: 20, y: 20 } });
    await at(page, 1);
  });

  test('FR-PRS-002: a typed number then Enter goes to that screen', async ({ page }) => {
    await open(page);
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await at(page, 11);
  });

  test('FR-SCR-002: a hidden screen is skipped going forward and back', async ({ page }) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await at(page, 1);
    // the hidden screen sits between the second and third of the fixture
    await page.keyboard.press('ArrowRight');
    await at(page, 2);
    await page.keyboard.press('ArrowLeft');
    await at(page, 1);
  });

  test('FR-PRS-002: the first and last screens hold: Left on the first and Right on the last stay put', async ({ page }) => {
    await open(page);
    await page.keyboard.press('ArrowLeft');
    await at(page, 0);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await at(page, shown.length - 1);
  });
});
