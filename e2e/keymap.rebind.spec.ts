import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// keys: desktop input
test.describe('the keyboard shortcuts', { tag: '@desktop' }, () => {
  test('FR-EDT-012: ? lists every shortcut; a rebinding persists across a reload and the old key stops acting', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);

    // ? opens the cheat sheet, with the bindings of the actions
    await page.keyboard.press('?');
    const keys = editor.keymapDialog;
    await expect(keys).toBeVisible();
    await expect(keys.getByRole('row', { name: /^Undo\b/ })).toContainText('Ctrl+Z');
    await expect(keys.getByRole('row', { name: /^Redo\b/ })).toContainText('Ctrl+Shift+Z, Ctrl+Y');
    await expect(keys.getByRole('row', { name: /^Hand tool\b/ })).toContainText('H');
    // keys typed in the dialog are not the canvas's: Ctrl+Z here undoes nothing
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(1);

    // Change waits for the next chord; Esc gives up; a chord rebinds the action
    await keys.getByRole('button', { name: 'Change Undo' }).click();
    await page.keyboard.press('Escape');
    await expect(keys.getByRole('row', { name: /^Undo\b/ })).toContainText('Ctrl+Z');
    await keys.getByRole('button', { name: 'Change Undo' }).click();
    await page.keyboard.press('Control+u');
    await expect(keys.getByRole('row', { name: /^Undo\b/ })).toContainText('Ctrl+U');
    await expect(keys.getByRole('row', { name: /^Undo\b/ })).not.toContainText('Ctrl+Z');
    // Esc (not waiting) closes the dialog
    await page.keyboard.press('Escape');
    await expect(keys).toHaveCount(0);

    // the old chord no longer undoes; the new one does
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(1);
    await page.keyboard.press('Control+u');
    await expect(editor.elements).toHaveCount(0);

    // the rebinding is kept across a reload
    await page.reload();
    await editor.screens.first().waitFor();
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(1);
    await page.keyboard.press('Control+u');
    await expect(editor.elements).toHaveCount(0);

    // Reset gives the default back
    await editor.toolbarButton('Keyboard shortcuts').click();
    await keys.getByRole('button', { name: 'Reset Undo' }).click();
    await expect(keys.getByRole('row', { name: /^Undo\b/ })).toContainText('Ctrl+Z');
    await expect(keys.getByRole('button', { name: 'Reset Undo' })).toHaveCount(0);
    await keys.getByRole('button', { name: 'Close' }).click();
    await expect(keys).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.elements).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(editor.elements).toHaveCount(0);
  });

  test('FR-EDT-012: giving an action a chord another action has takes it from that one', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await page.keyboard.press('?');
    const keys = editor.keymapDialog;
    await keys.getByRole('button', { name: 'Change Hand tool' }).click();
    await page.keyboard.press('v');
    await expect(keys.getByRole('row', { name: /^Hand tool\b/ })).toContainText('V');
    await expect(keys.getByRole('row', { name: /^Select tool\b/ })).toContainText('Not set');
    await keys.getByRole('button', { name: 'Close' }).click();
    // V is the hand now: it is pressed in the toolbar
    await page.keyboard.press('v');
    await expect(editor.toolButton('Hand')).toHaveAttribute('aria-pressed', 'true');
  });
});
