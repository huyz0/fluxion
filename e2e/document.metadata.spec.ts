import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

const details = (editor: EditorPage) => editor.root.getByRole('button', { name: 'Document details', exact: true });
const dialog = (editor: EditorPage) => editor.page.getByRole('dialog', { name: 'Document details' });

// a dialog with text fields: desktop input
test.describe('document metadata', { tag: '@desktop' }, () => {
  test('FR-DOC-006: edited metadata is kept: reopening the dialog shows it, and one undo takes it all back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await details(editor).click();
    const form = dialog(editor);
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Title')).toBeFocused();
    await form.getByLabel('Title').fill('Quarterly review');
    await form.getByLabel('Description').fill('Numbers for Q3');
    // a language that is not a tag blocks Save and says why
    await form.getByLabel('Language').fill('not a tag');
    await expect(form.getByRole('alert')).toContainText('language tag');
    await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
    await form.getByLabel('Language').fill('en-GB');
    await form.getByLabel('Authors').fill('Ada, Grace');
    await form.getByLabel('Tags').fill('finance, q3');
    await form.getByRole('button', { name: 'Add a custom field' }).click();
    await form.getByLabel('Custom field 1 name').fill('team');
    await form.getByLabel('Custom field 1 value').fill('finance');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toHaveCount(0);
    await expect(details(editor)).toBeFocused();

    // reopened, the dialog shows what was kept
    await details(editor).click();
    await expect(form.getByLabel('Title')).toHaveValue('Quarterly review');
    await expect(form.getByLabel('Description')).toHaveValue('Numbers for Q3');
    await expect(form.getByLabel('Language')).toHaveValue('en-GB');
    await expect(form.getByLabel('Authors')).toHaveValue('Ada, Grace');
    await expect(form.getByLabel('Tags')).toHaveValue('finance, q3');
    await expect(form.getByLabel('Custom field 1 name')).toHaveValue('team');
    await expect(form.getByLabel('Custom field 1 value')).toHaveValue('finance');
    // Esc leaves it as it is
    await form.getByLabel('Title').fill('Changed but not saved');
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await details(editor).click();
    await expect(form.getByLabel('Title')).toHaveValue('Quarterly review');
    await page.keyboard.press('Escape');

    // one undo takes the whole edit back
    await editor.toolbarButton('Undo').click();
    await details(editor).click();
    await expect(form.getByLabel('Title')).toHaveValue('');
    await expect(form.getByLabel('Authors')).toHaveValue('');
    await expect(form.getByLabel('Custom field 1 name')).toHaveCount(0);
  });
});
