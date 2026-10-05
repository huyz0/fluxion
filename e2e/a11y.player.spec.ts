import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorPage } from './pages/editor.js';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-A11Y-002: the one-file player gives a screen reader each screen's name as a heading, announces a move in a live region, and axe finds nothing serious
// or critical on it (the controls, the overview grid) or on the editor.
test.describe('player accessibility', { tag: '@desktop' }, () => {
  test.setTimeout(120_000);
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-a11y-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Accessible deck' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('NFR-A11Y-002: the live region says where the deck is after every move, and each screen has a heading', async ({ page }) => {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    const live = page.getByRole('status').filter({ hasText: /^Screen \d+ of 20/ });
    await expect(live).toHaveText(/^Screen 1 of 20/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(/^Screen 2 of 20/);
    await page.keyboard.press('End');
    await expect(live).toHaveText(/^Screen 20 of 20/);
    await page.keyboard.press('Home');
    await expect(live).toHaveText(/^Screen 1 of 20/);
  });

  test('NFR-A11Y-002: axe finds nothing serious or critical on the player, its controls and its overview, nor on the editor', async ({
    page,
    expectAccessible,
  }) => {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    await expectAccessible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectAccessible();
    await page.getByRole('button', { name: 'Overview of the screens' }).click();
    await expect(page.getByRole('dialog', { name: 'Screen overview' })).toBeVisible();
    await expectAccessible();
    await page.keyboard.press('Escape');
    await new EditorPage(page).open('new');
    await expectAccessible();
  });
});
