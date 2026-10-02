import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** A new document with three screens, the last shown (the navigator's New screen shows what it adds). */
async function threeScreens(editor: EditorPage): Promise<string[]> {
  await editor.open('new');
  const panel = editor.panel('Screens, library and layers');
  const add = panel.getByRole('button', { name: 'New screen', exact: true });
  await add.click();
  await add.click();
  const rows = panel.locator('.fx-chrome-screen');
  await expect(rows).toHaveCount(3);
  return (await rows.evaluateAll((all) => all.map((r) => r.getAttribute('data-screen-id') as string))) as string[];
}

const presented = (editor: EditorPage) => editor.page.getByTestId('present-in-place').locator('.fx-screen').getAttribute('data-screen-id');

// keys: desktop input
test.describe('presenting from the navigator', { tag: '@desktop' }, () => {
  test('FR-EDT-009: shift+F5 on a later screen presents that screen', async ({ page }) => {
    const editor = new EditorPage(page);
    const [, , third] = await threeScreens(editor);
    // the third screen is the one shown; shift+F5 presents it, and Esc comes back to it
    await page.keyboard.press('Shift+F5');
    await expect(editor.root).toHaveAttribute('data-mode', 'present');
    expect(await presented(editor)).toBe(third);
    await page.keyboard.press('Escape');
    await expect(editor.root).toHaveAttribute('data-mode', 'edit');
    await expect(editor.screenTab('Screen 3')).toHaveAttribute('aria-pressed', 'true');
  });

  test('FR-EDT-009: F5 presents the first visible screen', async ({ page }) => {
    const editor = new EditorPage(page);
    const [first, second] = await threeScreens(editor);
    // the first screen is hidden from presentation: F5 starts at the second, wherever the canvas is
    const row = editor.panel('Screens, library and layers').locator('.fx-chrome-screen').first();
    await row.getByRole('button', { name: 'Hide Screen 1 from presentation' }).click();
    await expect(row).toHaveAttribute('data-hidden', 'true');
    await page.keyboard.press('F5');
    await expect(editor.root).toHaveAttribute('data-mode', 'present');
    expect(await presented(editor)).toBe(second);
    expect(second).not.toBe(first);
    // F5 again returns
    await page.keyboard.press('F5');
    await expect(editor.root).toHaveAttribute('data-mode', 'edit');
  });
});
