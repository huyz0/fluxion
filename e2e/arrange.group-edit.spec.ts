import type { Page } from '@playwright/test';
import { drag, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

/** The two shapes drawn on a new document (left and right), grouped with Ctrl+G; the group is selected. */
async function grouped(page: Page) {
  const editor = new EditorPage(page);
  await editor.open('new');
  await shapeAt(page, editor, 0.1, 1);
  await shapeAt(page, editor, 0.5, 2);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(editor.inspectorText).toHaveText('1 element selected');
  await expect(editor.canvas.locator('.fx-el[data-kind="group"]')).toHaveCount(1);
  return editor;
}

const boxes = async (editor: EditorPage): Promise<Box[]> => Promise.all((await editor.shapes.all()).map(async (s) => (await s.boundingBox()) as Box));
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const handle = async (page: Page, id: string) => {
  const b = await page.locator(`[data-handle="${id}"]`).boundingBox();
  if (b === null) throw new Error(`no ${id} handle`);
  return centre(b);
};

// mouse drags and keys: desktop input
test.describe('groups', { tag: '@desktop' }, () => {
  test('FR-ARR-001: a group moves, resizes and rotates as one, and each is one undo step', async ({ page }) => {
    const editor = await grouped(page);
    const [a0, b0] = await boxes(editor);
    if (a0 === undefined || b0 === undefined) throw new Error('two shapes');
    // move: a drag from the first member takes both
    const from = centre(a0);
    await drag(page, from, { x: from.x + 40, y: from.y + 30 });
    const [a1, b1] = await boxes(editor);
    expect([(a1 as Box).x - a0.x, (a1 as Box).y - a0.y]).toEqual([expect.closeTo(40, 0), expect.closeTo(30, 0)]);
    expect([(b1 as Box).x - b0.x, (b1 as Box).y - b0.y]).toEqual([expect.closeTo(40, 0), expect.closeTo(30, 0)]);
    // resize: the se handle drags the group's corner and both members scale with it
    const se = await handle(page, 'se');
    await drag(page, se, { x: se.x + 80, y: se.y + 40 });
    const [a2, b2] = await boxes(editor);
    expect((a2 as Box).width).toBeGreaterThan((a1 as Box).width);
    expect((b2 as Box).width).toBeGreaterThan((b1 as Box).width);
    // rotate: the centres of the two members turn about the group's centre and keep their distance
    const before = [centre(a2 as Box), centre(b2 as Box)] as const;
    const grab = await handle(page, 'rotate');
    const middle = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
    await drag(page, grab, { x: middle.x + 200, y: middle.y + 1 });
    const [a3, b3] = await boxes(editor);
    const after = [centre(a3 as Box), centre(b3 as Box)] as const;
    const gap = (p: readonly [{ x: number; y: number }, { x: number; y: number }]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    expect(gap(after)).toBeCloseTo(gap(before), 0);
    expect(Math.abs(after[0].y - after[1].y)).toBeGreaterThan(Math.abs(before[0].y - before[1].y) + 10);
    // three gestures, three undo steps: both members are back where they started
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z');
    const [a4, b4] = await boxes(editor);
    expect([(a4 as Box).x, (a4 as Box).y, (a4 as Box).width]).toEqual([expect.closeTo(a0.x, 0), expect.closeTo(a0.y, 0), expect.closeTo(a0.width, 0)]);
    expect([(b4 as Box).x, (b4 as Box).y]).toEqual([expect.closeTo(b0.x, 0), expect.closeTo(b0.y, 0)]);
  });

  test('FR-ARR-001: a double-click enters the group, one member is edited alone, and Esc leaves it', async ({ page }) => {
    const editor = await grouped(page);
    const [a0, b0] = await boxes(editor);
    if (a0 === undefined || b0 === undefined) throw new Error('two shapes');
    const entered = page.locator('[data-entered="true"]');
    await expect(entered).toHaveCount(0);
    const inFirst = centre(a0);
    await page.mouse.dblclick(inFirst.x, inFirst.y);
    await expect(entered).toHaveCount(1);
    // a drag now takes the first member alone
    await drag(page, inFirst, { x: inFirst.x + 20, y: inFirst.y + 60 });
    const [a1, b1] = await boxes(editor);
    expect((a1 as Box).y - a0.y).toBeCloseTo(60, 0);
    expect((b1 as Box).y - b0.y).toBeCloseTo(0, 0);
    // Esc leaves the group, selecting it again: its frame is the bounds of its members, wherever the member went
    await page.keyboard.press('Escape');
    await expect(entered).toHaveCount(0);
    const frame = await page.locator('polygon.fx-chrome-frame').boundingBox();
    if (frame === null) throw new Error('the group has no frame');
    expect(frame.x).toBeCloseTo(Math.min((a1 as Box).x, (b1 as Box).x), -1);
    expect(frame.y).toBeCloseTo(Math.min((a1 as Box).y, (b1 as Box).y), -1);
    expect(frame.x + frame.width).toBeCloseTo(Math.max((a1 as Box).x + (a1 as Box).width, (b1 as Box).x + (b1 as Box).width), -1);
    expect(frame.y + frame.height).toBeCloseTo(Math.max((a1 as Box).y + (a1 as Box).height, (b1 as Box).y + (b1 as Box).height), -1);
    // and a drag takes both
    const second = centre(b0);
    await drag(page, second, { x: second.x, y: second.y + 40 });
    const [a2, b2] = await boxes(editor);
    expect((a2 as Box).y - (a1 as Box).y).toBeCloseTo(40, 0);
    expect((b2 as Box).y - (b1 as Box).y).toBeCloseTo(40, 0);
    // Ctrl+Shift+G dissolves the group: the shapes are selected, and the group element is gone
    await page.keyboard.press('ControlOrMeta+Shift+g');
    await expect(editor.canvas.locator('.fx-el[data-kind="group"]')).toHaveCount(0);
    await expect(editor.inspectorText).toHaveText('2 elements selected');
  });
});
