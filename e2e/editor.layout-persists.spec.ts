import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

const width = async (editor: EditorPage, name: string) => (await editor.panel(name).boundingBox())?.width;

test('FR-EDT-001: a resized panel keeps its width across a reload', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.open('new');
  expect(await width(editor, 'Screens, library and layers')).toBe(240);
  const splitter = editor.splitter('Resize the left panel');
  const box = await splitter.boundingBox();
  if (box === null) throw new Error('the left splitter is not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await width(editor, 'Screens, library and layers')).toBe(300);
  // the keyboard resizes too: the inspector grows toward the canvas
  await editor.splitter('Resize the inspector').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await width(editor, 'Inspector')).toBe(330);
  await page.reload();
  await editor.screens.first().waitFor();
  expect(await width(editor, 'Screens, library and layers')).toBe(300);
  expect(await width(editor, 'Inspector')).toBe(330);
  await expect(editor.splitter('Resize the left panel')).toHaveAttribute('aria-valuenow', '300');
});

test('FR-EDT-001: hidden panels and focus mode persist; the canvas keeps its screen', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.open('new');
  await expect(editor.panel('Timeline')).toHaveCount(0);
  await editor.toolbarButton('Timeline').click();
  await editor.toolbarButton('Inspector').click();
  await expect(editor.panel('Timeline')).toBeVisible();
  await expect(editor.panel('Inspector')).toHaveCount(0);
  await page.reload();
  await editor.screens.first().waitFor();
  await expect(editor.panel('Timeline')).toBeVisible();
  await expect(editor.panel('Inspector')).toHaveCount(0);
  await expect(editor.toolbarButton('Inspector')).toHaveAttribute('aria-pressed', 'false');
  await editor.toolbarButton('Focus mode').click();
  await page.reload();
  await editor.screens.first().waitFor();
  await expect(editor.toolbarButton('Focus mode')).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Screens, library and layers', 'Inspector', 'Timeline']) await expect(editor.panel(name)).toHaveCount(0);
  await expect(page.getByRole('separator')).toHaveCount(0);
  // focus mode gives the canvas the page below the toolbar
  const canvas = await editor.canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(canvas?.width).toBe(viewport?.width);
  await editor.toolbarButton('Focus mode').click();
  await expect(editor.panel('Screens, library and layers')).toBeVisible();
});
