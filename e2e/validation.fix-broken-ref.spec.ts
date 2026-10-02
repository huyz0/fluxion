import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// mouse drags: desktop input
test.describe('the Problems tab', { tag: '@desktop' }, () => {
  test('FR-EDT-021: the Problems tab lists what is wrong live, and Fix mends it in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await editor.panel('Screens, library and layers').getByRole('tab', { name: 'Problems' }).click();
    await expect(editor.panel('Screens, library and layers').getByText('No problems found.')).toBeVisible();
    // two shapes dragged out over the same box lie exactly on top of one another
    await dragOut(page, editor, 'Shape');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(2);
    const problems = editor.panel('Screens, library and layers').getByRole('list', { name: 'Problems' });
    await expect(problems).toContainText('2 elements lie exactly on top of one another');
    await problems.getByRole('button', { name: 'Select' }).click();
    await expect(editor.inspectorText).toHaveText('2 elements selected');
    await problems.getByRole('button', { name: 'Offset the top one' }).click();
    await expect(editor.panel('Screens, library and layers').getByText('No problems found.')).toBeVisible();
    // the fix is one undo step: the problem is back
    await page.keyboard.press('Control+z');
    await expect(problems).toContainText('2 elements lie exactly on top of one another');
  });
});
