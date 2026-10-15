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
});
