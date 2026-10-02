import type { Locator } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** Client coordinates of a page point of the gallery screen (1920 wide), through the fitted canvas. */
async function client(editor: EditorPage, x: number, y: number): Promise<{ x: number; y: number }> {
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  return { x: screen.x + x * scale, y: screen.y + y * scale };
}

const menu = (editor: EditorPage) => editor.page.getByRole('menu', { name: 'Context menu' });
const item = (editor: EditorPage, name: RegExp): Locator => menu(editor).getByRole('menuitem', { name });

// the gallery's first rectangle is at x 80-260, y 60-170; a second one lies at x 120-300, y 640-740
const RECT = [170, 115] as const;

test.describe('context menus: mouse', { tag: '@desktop' }, () => {
  test('FR-EDT-013: a right click on an element selects it and opens its menu; Select same type selects every rectangle', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const at = await client(editor, ...RECT);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(menu(editor)).toBeVisible();
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await expect(menu(editor).getByRole('menuitem')).toHaveText([/Cut/, /Copy/, /Duplicate/, /Delete the selection/, /Select same type/, /Select same style/]);
    await item(editor, /Select same type/).click();
    await expect(menu(editor)).toBeHidden();
    await expect(editor.inspectorText).toHaveText('2 elements selected');
  });

  test('FR-EDT-004: Select same style selects every element styled as the one clicked', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const at = await client(editor, ...RECT);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await item(editor, /Select same style/).click();
    // the gallery's shapes are all unstyled, so all 25 are styled as the rectangle (its connectors are another kind)
    await expect(editor.inspectorText).toHaveText('25 elements selected');
  });

  test('FR-EDT-013: the menu of a screen and of the canvas offer paste and the view; Esc closes and a press outside closes', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const empty = await client(editor, 1880, 20);
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    await expect(menu(editor).getByRole('menuitem')).toHaveText([/Paste/, /Select all/, /Zoom to fit the screen/]);
    await page.keyboard.press('Escape');
    await expect(menu(editor)).toBeHidden();
    // beyond the screen's edge, on the canvas around it
    const screen = await editor.screenBox();
    await page.mouse.click(screen.x - 10, screen.y + 40, { button: 'right' });
    await expect(menu(editor).getByRole('menuitem')).toHaveText([/Paste/, /Zoom to fit the screen/, /Zoom to 100 %/]);
    await page.mouse.click(screen.x + 500, screen.y + 300);
    await expect(menu(editor)).toBeHidden();
  });
});

test.describe('context menus: touch', { tag: '@mobile' }, () => {
  test('FR-EDT-013: a finger held on an element opens its menu; Select same type selects every rectangle', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await editor.showSidePanels();
    const at = await client(editor, ...RECT);
    await editor.canvas.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: at.x,
      clientY: at.y,
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
    });
    await expect(menu(editor)).toBeVisible();
    await editor.canvas.dispatchEvent('pointerup', {
      pointerType: 'touch',
      pointerId: 1,
      isPrimary: true,
      clientX: at.x,
      clientY: at.y,
      button: 0,
      buttons: 0,
      bubbles: true,
      cancelable: true,
    });
    await item(editor, /Select same type/).tap();
    await expect(editor.inspectorText).toHaveText('2 elements selected');
  });
});
