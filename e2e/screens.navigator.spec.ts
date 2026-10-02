import { readFileSync } from 'node:fs';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
const NAVIGATOR_OPEN_50_MAX_MS = Number(
  /NAVIGATOR_OPEN_50_MAX_MS: \{ value: ([\d.]+)/.exec(readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8'))?.[1],
);

/** A new document with `count` screens (the navigator's New screen button adds the rest). */
async function withScreens(editor: EditorPage, count: number): Promise<void> {
  await editor.open('new');
  const add = editor.panel('Screens, library and layers').getByRole('button', { name: 'New screen', exact: true });
  for (let i = 1; i < count; i++) await add.click();
  await expect(editor.panel('Screens, library and layers').locator('.fx-chrome-screen')).toHaveCount(count);
}

const order = (editor: EditorPage): Promise<(string | null)[]> =>
  editor
    .panel('Screens, library and layers')
    .locator('.fx-chrome-screen')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-screen-id')));

// drag and drop, double-click and the pointer timing: desktop input
test.describe('screens navigator', { tag: '@desktop' }, () => {
  test('FR-SCR-002: a dragged reorder persists through undo and redo', async ({ page }) => {
    const editor = new EditorPage(page);
    await withScreens(editor, 3);
    const [a, b, c] = (await order(editor)) as string[];
    const rows = editor.panel('Screens, library and layers').locator('.fx-chrome-screen');
    // the third screen dropped on the upper half of the first goes first
    await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 4 } });
    await expect.poll(() => order(editor)).toEqual([c, a, b]);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => order(editor)).toEqual([a, b, c]);
    await editor.toolbarButton('Redo').click();
    await expect.poll(() => order(editor)).toEqual([c, a, b]);
  });

  test('FR-SCR-002: a screen is renamed inline and a hidden screen is marked', async ({ page }) => {
    const editor = new EditorPage(page);
    await withScreens(editor, 2);
    await editor.screenTab('Screen 2').dblclick();
    const field = editor.panel('Screens, library and layers').getByRole('textbox', { name: 'Rename Screen 2' });
    await field.fill('Pricing');
    await field.press('Enter');
    await expect(editor.screenTab('Pricing')).toBeVisible();
    // Esc leaves the name as it was
    await editor.screenTab('Pricing').dblclick();
    await editor.panel('Screens, library and layers').getByRole('textbox', { name: 'Rename Pricing' }).fill('Nope');
    await page.keyboard.press('Escape');
    await expect(editor.screenTab('Pricing')).toBeVisible();
    // the eye marks the screen hidden, and again shows it
    const row = editor.panel('Screens, library and layers').locator('.fx-chrome-screen').filter({ hasText: 'Pricing' });
    await expect(row).not.toHaveAttribute('data-hidden', 'true');
    await row.getByRole('button', { name: 'Hide Pricing from presentation' }).click();
    await expect(row).toHaveAttribute('data-hidden', 'true');
    await row.getByRole('button', { name: 'Hide Pricing from presentation' }).click();
    await expect(row).not.toHaveAttribute('data-hidden', 'true');
  });

  test('FR-SCR-002: the screen menu duplicates and deletes a screen', async ({ page }) => {
    const editor = new EditorPage(page);
    await withScreens(editor, 2);
    const rows = editor.panel('Screens, library and layers').locator('.fx-chrome-screen');
    await editor.screenTab('Screen 1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(rows).toHaveCount(3);
    await editor.screenTab('Screen 3').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(rows).toHaveCount(2);
  });

  test('NFR-PERF-001: the navigator opens with 50 screens within NAVIGATOR_OPEN_50_MAX_MS', async ({ page }) => {
    const editor = new EditorPage(page);
    await withScreens(editor, 50);
    const toggle = editor.toolbarButton('Screens, library and layers');
    // closed, then opened: the time from the click until all 50 rows stand
    await toggle.click();
    await expect(editor.panel('Screens, library and layers')).toBeHidden();
    await page.evaluate(() => {
      const w = window as unknown as { opened?: number; started?: number };
      const button = document.querySelector('button[aria-pressed][title*="Screens"]') ?? document.body;
      button.addEventListener(
        'click',
        () => {
          w.started = performance.now();
        },
        { capture: true, once: true },
      );
      new MutationObserver((_, watch) => {
        if (document.querySelectorAll('.fx-chrome-screen').length >= 50 && w.opened === undefined) {
          w.opened = performance.now();
          watch.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await toggle.click();
    await expect(editor.panel('Screens, library and layers').locator('.fx-chrome-screen')).toHaveCount(50);
    const took = await page.evaluate(() => {
      const w = window as unknown as { opened?: number; started?: number };
      return (w.opened ?? Number.NaN) - (w.started ?? Number.NaN);
    });
    expect(took).toBeLessThan(NAVIGATOR_OPEN_50_MAX_MS);
  });
});
