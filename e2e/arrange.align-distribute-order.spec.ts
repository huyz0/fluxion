import type { Page } from '@playwright/test';
import { onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

/** A new document with one shape at each of `fractions` of the screen's width, in order of creation. */
async function shapes(page: Page, fractions: readonly number[]): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.open('new');
  for (const [i, fx] of fractions.entries()) await shapeAt(page, editor, fx, i + 1);
  return editor;
}

const boxes = async (editor: EditorPage): Promise<Box[]> => Promise.all((await editor.shapes.all()).map(async (s) => (await s.boundingBox()) as Box));
const ids = (editor: EditorPage): Promise<(string | null)[]> => editor.elements.evaluateAll((all) => all.map((e) => e.getAttribute('data-el-id')));

// the context menu, the keys and the pointer: desktop input
test.describe('arranging from the UI', { tag: '@desktop' }, () => {
  test('FR-ARR-002: align left from the context menu lines up three shapes', async ({ page }) => {
    const editor = await shapes(page, [0.1, 0.35, 0.7]);
    const before = await boxes(editor);
    expect(new Set(before.map((b) => Math.round(b.x))).size).toBe(3);
    await page.keyboard.press('ControlOrMeta+a');
    // the menu of the shape pressed on acts on the whole selection when it is part of it
    const on = await onScreen(editor, 0.76, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Align left' }).click();
    const after = await boxes(editor);
    const left = Math.min(...before.map((b) => b.x));
    for (const b of after) expect(b.x).toBeCloseTo(left, 0);
    // widths and heights are not touched, and one undo step takes it back
    expect(after.map((b) => Math.round(b.width))).toEqual(before.map((b) => Math.round(b.width)));
    await editor.toolbarButton('Undo').click();
    expect((await boxes(editor)).map((b) => Math.round(b.x))).toEqual(before.map((b) => Math.round(b.x)));
  });

  test('FR-ARR-003: distribute horizontally spaces them evenly', async ({ page }) => {
    const editor = await shapes(page, [0.05, 0.2, 0.7]);
    await page.keyboard.press('ControlOrMeta+a');
    const on = await onScreen(editor, 0.76, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Distribute horizontally' }).click();
    const [a, b, c] = (await boxes(editor)).sort((p, q) => p.x - q.x) as [Box, Box, Box];
    // the outer two stay; the gaps between the three are equal
    expect(c.x + c.width - a.x).toBeGreaterThan(0);
    expect(b.x - (a.x + a.width)).toBeCloseTo(c.x - (b.x + b.width), 0);
  });

  test('FR-ARR-004: Ctrl+] brings a shape forward and one undo takes it back', async ({ page }) => {
    // two overlapping shapes: the first made is behind
    const editor = await shapes(page, [0.1, 0.15]);
    const [back, front] = (await ids(editor)) as string[];
    const first = await onScreen(editor, 0.105, 0.4);
    await page.mouse.click(first.x, first.y);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await page.keyboard.press('ControlOrMeta+]');
    await expect.poll(() => ids(editor)).toEqual([front, back]);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => ids(editor)).toEqual([back, front]);
    // and the other way, with Ctrl+[
    await editor.toolbarButton('Redo').click();
    await page.keyboard.press('ControlOrMeta+[');
    await expect.poll(() => ids(editor)).toEqual([back, front]);
  });
});
