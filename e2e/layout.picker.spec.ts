import { shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The shapes' boxes, rounded, in document order. */
const boxes = async (editor: EditorPage): Promise<number[][]> =>
  (await editor.shapes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))).map((b) => [b.x, b.y, b.width, b.height].map(Math.round));

// keys and the pointer: desktop input
test.describe('the layout picker in the inspector', { tag: '@desktop' }, () => {
  test('FR-LAY-003: switching a selection from layered to radial lays it out again, and one undo brings the layered boxes back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    for (const [i, fx] of [0.1, 0.4, 0.7].entries()) await shapeAt(page, editor, fx, i + 1);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor.inspectorText).toHaveText('3 elements selected');
    const picker = page.getByRole('combobox', { name: 'Layout algorithm' });
    const start = await boxes(editor);
    await picker.selectOption('layered');
    // the layout runs on the page's thread or in a worker: the boxes change when it answers
    await expect.poll(async () => JSON.stringify(await boxes(editor)), { message: 'layered moved the shapes' }).not.toBe(JSON.stringify(start));
    const layered = await boxes(editor);
    await picker.selectOption('radial');
    await expect.poll(async () => JSON.stringify(await boxes(editor)), { message: 'radial moved them again' }).not.toBe(JSON.stringify(layered));
    await editor.toolbarButton('Undo').click();
    await expect.poll(async () => JSON.stringify(await boxes(editor)), { message: 'one undo takes back the radial layout' }).toBe(JSON.stringify(layered));
  });
});
