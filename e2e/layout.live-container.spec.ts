import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

/** The shapes' boxes, rounded, in document order. */
const boxes = async (editor: EditorPage): Promise<number[][]> =>
  (await editor.shapes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))).map((b: Box) => [b.x, b.y, b.width, b.height].map(Math.round));
const overlap = ([ax = 0, ay = 0, aw = 0, ah = 0]: readonly number[], [bx = 0, by = 0, bw = 0, bh = 0]: readonly number[]): boolean =>
  ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
const anyOverlap = (all: readonly number[][]): boolean => all.some((a, i) => all.slice(i + 1).some((b) => overlap(a, b)));

/** Open the live-tree fixture: a group with a live tree layout of three shapes. */
async function openLiveTree(page: Page): Promise<EditorPage> {
  await pickers(page, asPicker('live-tree.flux', await fluxFileOf('live-tree')));
  const editor = new EditorPage(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a file…' }).click();
  await editor.screens.first().waitFor();
  await expect(editor.shapes).toHaveCount(3);
  return editor;
}

/** Select the member shape `n` of the group: a double click enters the group, a click picks the member. */
async function selectMember(page: Page, editor: EditorPage, n: number): Promise<void> {
  const b = await editor.shapes.nth(n).boundingBox();
  if (b === null) throw new Error(`shape ${n} is not laid out`);
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.dblclick(x, y);
  await page.mouse.click(x, y);
  await expect(editor.inspectorText).toHaveText('1 element selected');
}

// keys and the pointer: desktop input
test.describe('live layout frames', { tag: '@desktop' }, () => {
  test('FR-LAY-010: a node added to a live tree group is laid out with the others, and one undo removes both', async ({ page }) => {
    const editor = await openLiveTree(page);
    const before = await boxes(editor);
    await selectMember(page, editor, 2);
    // a duplicate lands 16 px from its original, on top of it, until the group's layout places it
    await page.keyboard.press('ControlOrMeta+d');
    await expect(editor.shapes).toHaveCount(4);
    await expect.poll(async () => anyOverlap(await boxes(editor)), { message: 'the live layout placed the new node' }).toBe(false);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.shapes).toHaveCount(3);
    expect(await boxes(editor)).toEqual(before);
  });

  test('FR-LAY-010: a paste then a nudge inside a live group undo in two steps, the paste with its layout', async ({ page }) => {
    const editor = await openLiveTree(page);
    const before = await boxes(editor);
    await selectMember(page, editor, 2);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.shapes).toHaveCount(4);
    await expect.poll(async () => anyOverlap(await boxes(editor)), { message: 'the live layout placed the pasted node' }).toBe(false);
    const laidOut = await boxes(editor);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => boxes(editor)).not.toEqual(laidOut);
    // the first undo takes back the nudge only, the second the paste and its layout
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => boxes(editor)).toEqual(laidOut);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.shapes).toHaveCount(3);
    expect(await boxes(editor)).toEqual(before);
  });
});
