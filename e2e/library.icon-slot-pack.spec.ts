import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// the inspector and the library: desktop input
test.describe('icon slots and the first-party packs', { tag: '@desktop' }, () => {
  test('FR-LIB-009: an icon slot filled with a first-party pack icon nothing has loaded yet loads it and draws it', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('feature card');
    await left.locator('[data-def-id="infographic:feature-card"]').getByRole('button').click();
    await expect(editor.elements).toHaveCount(1);
    const card = editor.elements.first();
    // lucide:server is in the catalog but not loaded: no pick, drop or shape has used it
    const slot = editor.panel('Inspector').getByRole('textbox', { name: 'Icon shape for icon' });
    await slot.fill('lucide:server');
    await slot.press('Enter');
    await expect(card.locator('svg.fx-icon-slot[data-slot="icon"] path').first()).toBeAttached();
    await expect(slot).toHaveValue('lucide:server');
    await expectAccessible();
  });
});
