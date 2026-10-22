import { onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

const boxes = async (editor: EditorPage): Promise<Box[]> => Promise.all((await editor.shapes.all()).map(async (s) => (await s.boundingBox()) as Box));
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Whether any two of `all` overlap. */
const anyOverlap = (all: readonly Box[]): boolean => all.some((a, i) => all.slice(i + 1).some((b) => overlap(a, b)));

// the context menu and the pointer: desktop input
test.describe('arranging a selection with a layout', { tag: '@desktop' }, () => {
  test('FR-LAY-005: Arrange the selection from the context menu leaves no overlap, and one undo brings the old boxes back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // three shapes 12 % wide, 5 % apart: each lies on the next
    for (const [i, fx] of [0.1, 0.15, 0.2].entries()) await shapeAt(page, editor, fx, i + 1);
    const before = await boxes(editor);
    expect(anyOverlap(before)).toBe(true);
    await page.keyboard.press('ControlOrMeta+a');
    const on = await onScreen(editor, 0.28, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Arrange the selection (grid)' }).click();
    // the layout runs in a worker: the boxes change when it answers
    await expect.poll(async () => anyOverlap(await boxes(editor)), { message: 'the arranged shapes no longer overlap' }).toBe(false);
    const after = await boxes(editor);
    expect(after.map((b) => Math.round(b.width))).toEqual(before.map((b) => Math.round(b.width)));
    await editor.toolbarButton('Undo').click();
    expect((await boxes(editor)).map((b) => [Math.round(b.x), Math.round(b.y)])).toEqual(before.map((b) => [Math.round(b.x), Math.round(b.y)]));
  });

  test('FR-LAY-011: Tidy up from the context menu pulls two overlapping shapes apart with a small move, and one undo brings them back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // two shapes 12 % wide, 10 % apart: they overlap by a sliver
    for (const [i, fx] of [0.1, 0.2].entries()) await shapeAt(page, editor, fx, i + 1);
    const before = await boxes(editor);
    expect(anyOverlap(before)).toBe(true);
    await page.keyboard.press('ControlOrMeta+a');
    const on = await onScreen(editor, 0.18, 0.4);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Tidy up' }).click();
    await expect.poll(async () => anyOverlap(await boxes(editor)), { message: 'the tidied shapes no longer overlap' }).toBe(false);
    // a cleanup, not a re-layout: each shape moved less than its own width
    for (const [i, b] of (await boxes(editor)).entries()) {
      const was = before[i] as Box;
      expect(Math.hypot(b.x - was.x, b.y - was.y)).toBeLessThan(was.width);
    }
    await editor.toolbarButton('Undo').click();
    expect((await boxes(editor)).map((b) => [Math.round(b.x), Math.round(b.y)])).toEqual(before.map((b) => [Math.round(b.x), Math.round(b.y)]));
  });
  test('FR-LAY-012: Fit content to screen from the context menu puts shapes that reach the screen edges inside its safe area, and one undo brings them back', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // one shape at the left edge, one reaching the right edge: both in the 5 % margin, too far apart to fit without scaling
    for (const [i, fx] of [0.005, 0.875].entries()) await shapeAt(page, editor, fx, i + 1);
    const before = await boxes(editor);
    const on = await onScreen(editor, 0.5, 0.8);
    await page.mouse.click(on.x, on.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Fit content to screen' }).click();
    // the safe area: the screen inset by 5 % of its smaller side (the height of the 16:9 screen)
    const screen = await editor.screenBox();
    const margin = screen.height * 0.05;
    const inside = (b: Box): boolean =>
      b.x >= screen.x + margin - 1 &&
      b.y >= screen.y + margin - 1 &&
      b.x + b.width <= screen.x + screen.width - margin + 1 &&
      b.y + b.height <= screen.y + screen.height - margin + 1;
    await expect.poll(async () => (await boxes(editor)).every(inside), { message: 'the fitted shapes are inside the safe area' }).toBe(true);
    // scaled down together: both shapes keep one size
    const after = await boxes(editor);
    expect(Math.round((after[0] as Box).width)).toBe(Math.round((after[1] as Box).width));
    expect((after[0] as Box).width).toBeLessThan((before[0] as Box).width);
    await editor.toolbarButton('Undo').click();
    expect((await boxes(editor)).map((b) => [Math.round(b.x), Math.round(b.width)])).toEqual(before.map((b) => [Math.round(b.x), Math.round(b.width)]));
  });
});
