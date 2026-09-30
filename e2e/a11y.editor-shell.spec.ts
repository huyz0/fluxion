import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The editor shell's accessibility (FR-EDT-001, NFR-A11Y-001): axe finds nothing serious or critical
// in the shell as it opens, with a selection, with the timeline and image picker open, and while
// presenting; the toolbar, panels and canvas are landmarks or named regions a screen reader can reach.
test.describe('editor shell accessibility', { tag: '@desktop' }, () => {
  test('FR-EDT-001: the shell has named landmarks for the toolbar, panels and canvas, and axe finds no serious issue', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    // landmarks: the toolbar (banner), the canvas (main), the side panels (complementary), all named
    await expect(page.getByRole('banner', { name: 'Toolbar' })).toHaveCount(1);
    await expect(page.getByRole('main', { name: 'Canvas' })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'Screens, library and layers' })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Tools' })).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Zoom' })).toHaveCount(1);
    await expectAccessible();
    // a selection (the overlay mounts), the timeline open
    const c = await editor.canvasCentre();
    await page.mouse.click(c.x, c.y);
    await editor.toolbarButton('Timeline').click();
    await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(1);
    await expectAccessible();
  });

  test('FR-EDT-001: the image picker is a named modal dialog, and presenting stays accessible', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await editor.toolButton('Image').click();
    const c = await editor.canvasCentre();
    await page.mouse.click(c.x, c.y);
    const picker = page.getByRole('dialog', { name: 'Choose an image' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Image placeholder' })).toBeFocused();
    await expectAccessible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('F5');
    await expect(page.getByTestId('present-in-place')).toBeVisible();
    await expectAccessible();
  });
});
