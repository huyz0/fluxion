import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's first shape: a filled rectangle at x 80-260, y 60-170 on its 1920-wide screen. */
const RECT = 'SvJFIk0oCSKcTo6X';

/** The page scale of the fitted gallery screen, and a client point for a page point on it. */
async function onScreen(editor: EditorPage) {
  const screen = await editor.screenBox();
  const scale = screen.width / 1920;
  return { scale, at: (x: number, y: number) => ({ x: screen.x + x * scale, y: screen.y + y * scale }) };
}

async function boxOf(editor: EditorPage, id: string) {
  const box = await editor.element(id).boundingBox();
  if (box === null) throw new Error(`${id} is not drawn`);
  return box;
}

// mouse drags and keys: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('moving elements', { tag: '@desktop' }, () => {
  test('FR-EDT-005: a drag moves the shape with the pointer', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    // the drag is the pointer's exactly: snapping (snapping.smart-guides.spec.ts) is off
    await editor.toolbarButton('Snapping').click();
    const { scale, at } = await onScreen(editor);
    const before = await boxOf(editor, RECT);
    const from = at(170, 115);
    const to = at(270, 145);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    const after = await boxOf(editor, RECT);
    expect(after.x - before.x).toBeCloseTo(100 * scale, 0);
    expect(after.y - before.y).toBeCloseTo(30 * scale, 0);
    await expect(editor.inspectorText).toHaveText('1 element selected');
  });

  test('FR-EDT-005: arrow keys nudge the selection 1 px, and 10 px with shift', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const { scale, at } = await onScreen(editor);
    const inside = at(170, 115);
    await page.mouse.click(inside.x, inside.y);
    const before = await boxOf(editor, RECT);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await boxOf(editor, RECT)).y - before.y).toBeCloseTo(20 * scale, 1);
    expect((await boxOf(editor, RECT)).x - before.x).toBeCloseTo(5 * scale, 1);
  });

  test('FR-EDT-005: alt-drag moves a copy and leaves the original', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await expect(editor.shapes).toHaveCount(25);
    await editor.toolbarButton('Snapping').click();
    const { scale, at } = await onScreen(editor);
    const before = await boxOf(editor, RECT);
    const from = at(170, 115);
    const to = at(170, 515);
    await page.mouse.move(from.x, from.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(editor.shapes).toHaveCount(26);
    // the original stays; a copy of it sits 400 below
    expect(await boxOf(editor, RECT)).toEqual(before);
    const copies = await editor.shapes.evaluateAll(
      (els, id) => els.filter((e) => e.getAttribute('data-el-id') !== id).map((e) => e.getAttribute('data-el-id')),
      RECT,
    );
    const moved = await Promise.all(copies.map(async (id) => ({ id, box: await boxOf(editor, id as string) })));
    const copy = moved.find(({ box }) => Math.abs(box.x - before.x) < 1 && Math.abs(box.y - before.y - 400 * scale) < 1);
    expect(copy).toBeDefined();
    await expect(editor.inspectorText).toHaveText('1 element selected');
  });
});
