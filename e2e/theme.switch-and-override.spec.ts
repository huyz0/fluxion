import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The `--fx-color-background` the shown screen defines (a theme's CSS variable on `.fx-screen`). */
const background = (editor: EditorPage): Promise<string> =>
  editor.screens.first().evaluate((el) => getComputedStyle(el).getPropertyValue('--fx-color-background').trim());

/** A new document with two screens, the first shown. */
async function twoScreens(editor: EditorPage): Promise<void> {
  await editor.open('new');
  const panel = editor.panel('Screens, library and layers');
  await panel.getByRole('button', { name: 'New screen', exact: true }).click();
  await expect(panel.locator('.fx-chrome-screen')).toHaveCount(2);
  await panel.locator('.fx-chrome-screen').first().click();
}

const showScreen = (editor: EditorPage, index: number) => editor.panel('Screens, library and layers').locator('.fx-chrome-screen').nth(index).click();

// a select and the toolbar: desktop input
test.describe('themes', { tag: '@desktop' }, () => {
  test('FR-THM-004: switching the theme recolours every screen and one undo restores it', async ({ page }) => {
    const editor = new EditorPage(page);
    await twoScreens(editor);
    const light = await background(editor);
    await editor.root.getByLabel('Theme', { exact: true }).selectOption({ label: 'dark' });
    const dark = await background(editor);
    expect(dark).not.toBe(light);
    // the other screen follows the document's theme too
    await showScreen(editor, 1);
    await expect.poll(() => background(editor)).toBe(dark);
    await showScreen(editor, 0);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => background(editor)).toBe(light);
    await showScreen(editor, 1);
    await expect.poll(() => background(editor)).toBe(light);
  });

  test('FR-THM-004: a screen override survives a document theme switch', async ({ page }) => {
    const editor = new EditorPage(page);
    await twoScreens(editor);
    const light = await background(editor);
    await editor.root.getByLabel('Screen theme', { exact: true }).selectOption({ label: 'blueprint' });
    const blueprint = await background(editor);
    expect(blueprint).not.toBe(light);
    await editor.root.getByLabel('Theme', { exact: true }).selectOption({ label: 'dark' });
    // the overriding screen keeps its own values; the other screen took the new document theme
    await expect.poll(() => background(editor)).toBe(blueprint);
    await showScreen(editor, 1);
    const dark = await background(editor);
    expect(dark).not.toBe(blueprint);
    expect(dark).not.toBe(light);
    // removing the override returns the first screen to the document's theme
    await showScreen(editor, 0);
    await editor.root.getByLabel('Screen theme', { exact: true }).selectOption({ label: 'Follows the document' });
    await expect.poll(() => background(editor)).toBe(dark);
  });
});
