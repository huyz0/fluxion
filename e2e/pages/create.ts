import type { Page } from '@playwright/test';
import { expect } from '../test.js';
import type { EditorPage } from './editor.js';

/**
 * On a new document: pick the tool by its button, drag a box on the screen from 30 % to 50 % of its
 * width and height, and return the page point of that box's top-left corner and its size, page units.
 */
export async function dragOut(page: Page, editor: EditorPage, tool: string): Promise<{ x: number; y: number; w: number; h: number }> {
  await editor.toolButton(tool).click();
  await expect(editor.toolButton(tool)).toHaveAttribute('aria-pressed', 'true');
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  const from = { x: Math.round(screen.x + screen.width * 0.3), y: Math.round(screen.y + screen.height * 0.3) };
  const to = { x: Math.round(screen.x + screen.width * 0.5), y: Math.round(screen.y + screen.height * 0.5) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  return { x: (from.x - screen.x) / scale, y: (from.y - screen.y) / scale, w: (to.x - from.x) / scale, h: (to.y - from.y) / scale };
}

/** One element was added, selected, and the select tool is back; ctrl+Z removes it in one step. */
export async function expectOneAddedThenUndone(page: Page, editor: EditorPage, kind: string): Promise<void> {
  await expect(editor.elements).toHaveCount(1);
  await expect(editor.canvas.locator(`.fx-el[data-kind="${kind}"]`)).toHaveCount(1);
  await expect(editor.inspectorText).toHaveText('1 element selected');
  await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await expect(editor.elements).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor.elements).toHaveCount(1);
}
