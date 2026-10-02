import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// typing and focus: desktop input
test.describe('speaker notes', { tag: '@desktop' }, () => {
  test('FR-SCR-006: notes persist across screen switches and undo', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    const tab = (name: string) => left.getByRole('tab', { name, exact: true });
    const notes = left.getByRole('textbox', { name: 'Speaker notes' });
    // write the first screen's notes; leaving the tab commits them
    await tab('Notes').click();
    await notes.click();
    await page.keyboard.type('Welcome everyone');
    await tab('Screens').click();
    await left.getByRole('button', { name: 'New screen', exact: true }).click();
    // the second screen starts with none; it gets its own
    await tab('Notes').click();
    await expect(notes).toHaveText('');
    await notes.click();
    await page.keyboard.type('Pricing slide');
    await tab('Screens').click();
    await editor.screenTab('Screen 1').click();
    await tab('Notes').click();
    await expect(notes).toHaveText('Welcome everyone');
    await tab('Screens').click();
    await editor.screenTab('Screen 2').click();
    await tab('Notes').click();
    await expect(notes).toHaveText('Pricing slide');
    // undo takes the second screen's notes away, redo brings them back
    await editor.toolbarButton('Undo').click();
    await expect(notes).toHaveText('');
    await editor.toolbarButton('Redo').click();
    await expect(notes).toHaveText('Pricing slide');
    // emptying the field removes the notes rather than leaving an empty document
    await notes.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await tab('Screens').click();
    await tab('Notes').click();
    await expect(notes).toHaveText('');
    await editor.toolbarButton('Undo').click();
    await expect(notes).toHaveText('Pricing slide');
  });
});
