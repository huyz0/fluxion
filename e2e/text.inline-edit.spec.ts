import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** A new document with one text box placed by the text tool, its box returned (page units) and the select tool active. */
async function textBox(editor: EditorPage, page: import('@playwright/test').Page) {
  await editor.open('new');
  const box = await dragOut(page, editor, 'Text');
  await expect(editor.elements).toHaveCount(1);
  return box;
}

const editorBox = (editor: EditorPage) => editor.canvas.getByTestId('text-editor');

// keyboard and mouse: desktop input
test.describe('editing text in place', { tag: '@desktop' }, () => {
  test('FR-TXT-003: a double-click opens the text, Ctrl+B/I/U mark it and Esc commits it as one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await textBox(editor, page);
    const label = editor.elements.first().locator('.fx-label');
    // the canvas takes the pointer (tools hit-test by geometry), so the double-click is at the box's centre
    const at = await editor.elements.first().boundingBox();
    if (at === null) throw new Error('the text box is not drawn');
    await page.mouse.dblclick(at.x + at.width / 2, at.y + at.height / 2);
    await expect(editorBox(editor)).toBeVisible();
    // the text is selected on open: typing replaces it
    await page.keyboard.type('Hello world');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.press('ControlOrMeta+i');
    await page.keyboard.press('ControlOrMeta+u');
    await expect(editorBox(editor).locator('strong em u').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editorBox(editor)).toHaveCount(0);
    await expect(label).toHaveText('Hello world');
    await expect(label.locator('strong')).toHaveText('Hello world');
    await expect(label.locator('em')).toHaveText('Hello world');
    await expect(label.locator('u')).toHaveText('Hello world');
    // typing, marking and committing is one undo step; redo brings it back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(label).toHaveText('Text');
    await expect(label.locator('strong')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(label).toHaveText('Hello world');
  });

  test('FR-TXT-003: Enter opens the selected element, and Esc with no change writes nothing', async ({ page }) => {
    const editor = new EditorPage(page);
    await textBox(editor, page);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    await page.keyboard.press('Enter');
    await expect(editorBox(editor)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editorBox(editor)).toHaveCount(0);
    // nothing was written: the one undo step left is the element's creation
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements).toHaveCount(0);
  });

  test("FR-SHP-006: editing a grow shape's text grows it in the same undo step", async ({ page }) => {
    const editor = new EditorPage(page);
    await textBox(editor, page);
    const before = await editor.elements.first().boundingBox();
    await page.keyboard.press('Enter');
    await expect(editorBox(editor)).toBeVisible();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.type(`line ${i}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('Escape');
    await expect(editorBox(editor)).toHaveCount(0);
    await expect.poll(async () => (await editor.elements.first().boundingBox())?.height ?? 0).toBeGreaterThan((before?.height ?? 0) * 1.3);
    // one step takes back the text and the height together
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements.first().locator('.fx-label')).toHaveText('Text');
    expect((await editor.elements.first().boundingBox())?.height).toBeCloseTo(before?.height ?? 0, 0);
  });
});
