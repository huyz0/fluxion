import type { Page } from '@playwright/test';
import { expect } from '../test.js';
import type { EditorPage } from './editor.js';

/** A point on the first screen, at fractions of its width and height, in page px. */
export async function onScreen(editor: EditorPage, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const screen = await editor.screenBox();
  return { x: screen.x + screen.width * fx, y: screen.y + screen.height * fy };
}

/** Drag from `from` to `to` with the pointer, in steps. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/**
 * On a new document: a shape at `fx` of the screen's width (rows at 30-50 %), 12 % wide, by the shape tool; the
 * select tool is current afterwards.
 */
export async function shapeAt(page: Page, editor: EditorPage, fx: number, count: number): Promise<void> {
  await editor.toolButton('Shape').click();
  await drag(page, await onScreen(editor, fx, 0.3), await onScreen(editor, fx + 0.12, 0.5));
  await expect(editor.elements).toHaveCount(count);
}

/** Two shapes (left and right) joined by a connector, which is selected. */
export async function joinedPair(page: Page, editor: EditorPage): Promise<void> {
  await editor.open('new');
  await shapeAt(page, editor, 0.1, 1);
  await shapeAt(page, editor, 0.6, 2);
  await editor.toolButton('Connector').click();
  await drag(page, await onScreen(editor, 0.16, 0.4), await onScreen(editor, 0.66, 0.4));
  await expect(editor.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
}

/** The centre of a connector handle on the page: `source`, `target` or `mid-<n>`. */
export async function handleCentre(editor: EditorPage, which: string): Promise<{ x: number; y: number }> {
  const box = await editor.canvas.locator(`[data-connector-handle="${which}"]`).boundingBox();
  if (box === null) throw new Error(`no handle ${which}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
