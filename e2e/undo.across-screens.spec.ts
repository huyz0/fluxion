import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// keys and drags: desktop input
test.describe('undo across screens', { tag: '@desktop' }, () => {
  test('FR-EDT-006: undoing an edit made on another screen shows that screen again, and redo brings the edit back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-r0-static');
    await editor.showSidePanels();
    await expect(editor.screenTab('Request path')).toHaveAttribute('aria-pressed', 'true');
    const onFirst = await editor.shapes.count();

    // add a shape on the second screen (the Screens tab lists them in order: Request path, then Deployment)
    await editor.screenTab('Deployment').click();
    await expect(editor.screenTab('Deployment')).toHaveAttribute('aria-pressed', 'true');
    const onSecond = await editor.shapes.count();
    await dragOut(page, editor, 'Shape');
    await expect(editor.shapes).toHaveCount(onSecond + 1);
    await expect(editor.inspectorText).toHaveText('1 element selected');

    // go back to the first screen: undo is available, and the toolbar's Undo takes the edit back
    await editor.screenTab('Request path').click();
    await expect(editor.shapes).toHaveCount(onFirst);
    await expect(editor.inspectorText).toHaveText('Select an element to see its properties.');
    await editor.toolbarButton('Undo').click();
    await expect(editor.screenTab('Deployment')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.screenTab('Request path')).toHaveAttribute('aria-pressed', 'false');
    await expect(editor.shapes).toHaveCount(onSecond);
    // what was selected before the edit (nothing) is selected again
    await expect(editor.inspectorText).toHaveText('Select an element to see its properties.');

    // redo on the other screen shows the edit's screen again, with the new shape selected
    await editor.screenTab('Request path').click();
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.screenTab('Deployment')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.shapes).toHaveCount(onSecond + 1);
    await expect(editor.inspectorText).toHaveText('1 element selected');

    // undo on the screen the edit was made on stays there; the toolbar buttons follow the history
    await page.keyboard.press('Control+z');
    await expect(editor.screenTab('Deployment')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.shapes).toHaveCount(onSecond);
    await expect(editor.toolbarButton('Undo')).toBeDisabled();
    await expect(editor.toolbarButton('Redo')).toBeEnabled();
  });
});
