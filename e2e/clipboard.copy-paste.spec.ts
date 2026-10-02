import { joinedPair } from './pages/connectors.js';
import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// keys: desktop input
test.describe('copy and paste inside a document', { tag: '@desktop' }, () => {
  test('FR-EDT-007: copy and paste step 16 px each time, duplicate leaves the clipboard, and each is one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    const lefts = async () => (await editor.elements.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left))).sort((a, b) => a - b);
    const [origin] = await lefts();
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.elements).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.elements).toHaveCount(3);
    const [a, b, c] = await lefts();
    expect(a).toBeCloseTo(origin ?? 0, 0);
    expect((b ?? 0) - (a ?? 0)).toBeCloseTo(16 * scale, 0);
    expect((c ?? 0) - (a ?? 0)).toBeCloseTo(32 * scale, 0);
    // the pasted element is the selection
    await expect(editor.inspectorText).toHaveText('1 element selected');
    // duplicate: a copy 16 px from the selected one; the next paste continues from the clipboard
    await page.keyboard.press('ControlOrMeta+d');
    await expect(editor.elements).toHaveCount(4);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.elements).toHaveCount(5);
    expect(((await lefts()).at(-1) ?? 0) - (a ?? 0)).toBeCloseTo(48 * scale, 0);
    // one undo takes back one paste
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements).toHaveCount(4);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements).toHaveCount(3);
  });

  test('FR-EDT-007: a copied connector with its two shapes is pasted with them, and cut then paste brings it back', async ({ page }) => {
    const editor = new EditorPage(page);
    await joinedPair(page, editor);
    await expect(editor.elements).toHaveCount(3);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.elements).toHaveCount(6);
    await expect(editor.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(2);
    // the pasted ones are selected: three of them
    await expect(editor.inspectorText).toHaveText('3 elements selected');
    // cut takes them away, paste brings them back as three
    await page.keyboard.press('ControlOrMeta+x');
    await expect(editor.elements).toHaveCount(3);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.elements).toHaveCount(6);
  });
});
