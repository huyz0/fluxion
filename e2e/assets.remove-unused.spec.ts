import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** Fire a paste event carrying a PNG drawn in the page (what Ctrl/Cmd+V fires; a picture cannot be put on the clipboard from a test). */
async function pasteImage(page: Page, image: { w: number; h: number; colour: string }): Promise<void> {
  await page.evaluate(async ({ w, h, colour }) => {
    const data = new DataTransfer();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (g) {
      g.fillStyle = colour;
      g.fillRect(0, 0, w, h);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    data.items.add(new File([blob as Blob], 'pasted.png', { type: 'image/png' }));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    document.body.dispatchEvent(event);
  }, image);
}

// a dialog with file inputs and keyboard deletes: desktop input
test.describe('the asset manager', { tag: '@desktop' }, () => {
  test('FR-AST-005: Remove unused deletes only the assets nothing references, and one undo brings them back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // two different pictures: two assets, two image elements
    await pasteImage(page, { w: 600, h: 300, colour: '#c0392b' });
    await expect(editor.elements).toHaveCount(1);
    await pasteImage(page, { w: 300, h: 300, colour: '#2980b9' });
    await expect(editor.elements).toHaveCount(2);
    // the second element goes: its asset stays in the document, unreferenced
    await page.keyboard.press('Delete');
    await expect(editor.elements).toHaveCount(1);

    const assets = editor.root.getByRole('button', { name: 'Assets', exact: true });
    await assets.click();
    const dialog = page.getByRole('dialog', { name: 'Assets' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(dialog.getByText('Unused', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Used', { exact: true })).toHaveCount(1);
    // the picture the element shows cannot be removed one by one, and every row says what it costs
    await expect(dialog.getByRole('button', { name: /^Remove pasted\.png$/ }).first()).toBeVisible();
    await expect(dialog.getByText(/image\/(png|webp), .* \(\d+%\)/)).toHaveCount(2);

    await dialog.getByRole('button', { name: 'Remove unused (1)' }).click();
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(dialog.getByText('Used', { exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Remove unused (0)' })).toBeDisabled();
    // the element that used the kept asset still draws its picture
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(assets).toBeFocused();
    await expect(editor.canvas.locator('.fx-el[data-kind="image"] image.fx-image')).toHaveCount(1);

    // one undo brings the removed asset back
    await page.keyboard.press('ControlOrMeta+z');
    await assets.click();
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(dialog.getByText('Unused', { exact: true })).toHaveCount(1);
  });

  test('FR-AST-005: Replace changes the picture every element shows, and one undo brings the old picture back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await pasteImage(page, { w: 600, h: 300, colour: '#c0392b' });
    const image = editor.canvas.locator('.fx-el[data-kind="image"] image.fx-image');
    await expect(image).toHaveCount(1);
    const before = (await image.getAttribute('href')) ?? '';
    // a pasted picture went through the import pipeline, which keeps a PNG or re-encodes it as WebP where that is smaller (M10.31)
    expect(/^data:image\/(png|webp);base64,/.test(before)).toBe(true);

    await editor.root.getByRole('button', { name: 'Assets', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assets' });
    // Replace is a button a keyboard reaches; the file arrives through the row's input
    await expect(dialog.getByRole('button', { name: 'Replace pasted.png' })).toBeEnabled();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
    await expect(image).not.toHaveAttribute('href', before);
    await expect(image).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(image).toHaveAttribute('href', before);
  });
});
