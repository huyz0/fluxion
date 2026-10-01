import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// keyboard input: desktop
test.describe('markdown shortcuts in place', { tag: '@desktop' }, () => {
  test('FR-TXT-004: `# `, `- `, `1. `, `**b**`, `_i_` and backticks format the text as typed, and Esc stores it', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Text');
    const label = editor.elements.first().locator('.fx-label');
    await page.keyboard.press('Enter');
    await expect(editor.canvas.getByRole('textbox', { name: 'Text' })).toBeVisible();
    await page.keyboard.type('# Title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('plain **bold** and _slanted_ and `code`');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. first');
    await page.keyboard.press('Escape');
    await expect(label.locator('h1')).toHaveText('Title');
    await expect(label.locator('strong')).toHaveText('bold');
    await expect(label.locator('em')).toHaveText('slanted');
    await expect(label.locator('code')).toHaveText('code');
    await expect(label.locator('ul > li')).toHaveText(['one', 'two']);
    await expect(label.locator('ol > li')).toHaveText(['first']);
    // the markers are gone from the text
    await expect(label).not.toContainText('**');
    await expect(label).not.toContainText('# ');
  });
});
