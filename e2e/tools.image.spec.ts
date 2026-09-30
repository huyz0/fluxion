import { dragOut, expectOneAddedThenUndone } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// a mouse drag: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('the image tool', { tag: '@desktop' }, () => {
  test('FR-EDT-003: the image tool asks for an image; the placeholder picked adds exactly one element, undone in one step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Image');
    const picker = page.getByRole('dialog', { name: 'Choose an image' });
    await expect(picker).toBeVisible();
    await expect(picker.getByText('This document holds no images yet.')).toBeVisible();
    // Esc adds nothing
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(editor.elements).toHaveCount(0);
    await dragOut(page, editor, 'Image');
    await picker.getByRole('button', { name: 'Image placeholder' }).click();
    await expect(picker).toHaveCount(0);
    await expectOneAddedThenUndone(page, editor, 'shape');
  });
});
