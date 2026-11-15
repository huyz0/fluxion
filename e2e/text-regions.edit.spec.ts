import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// the pointer and the keys: desktop input
test.describe('text regions', { tag: '@desktop' }, () => {
  test('FR-SHP-007: the body region of a card is edited in place (double-click or Tab) and only it changes; the icon slot is filled from the inspector', async ({
    page,
    expectAccessible,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('feature card');
    await left.locator('[data-def-id="infographic:feature-card"]').getByRole('button').click();
    await expect(editor.elements).toHaveCount(1);
    const card = editor.elements.first();
    const title = card.locator('.fx-label:not(.fx-region)');
    const at = await card.boundingBox();
    if (at === null) throw new Error('the card is not drawn');
    const open = editor.canvas.getByTestId('text-editor');
    // the title region (0.32..0.94 across, 0.06..0.34 down) holds the element's own text
    await page.mouse.dblclick(at.x + at.width * 0.63, at.y + at.height * 0.2);
    await expect(open).toBeVisible();
    await page.keyboard.type('Fast');
    // Tab commits the title and opens the next region (the body), from the keyboard alone
    await page.keyboard.press('Tab');
    await expect(open).toBeVisible();
    await expect(title).toHaveText('Fast');
    await page.keyboard.type('Loads quickly');
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect(card.locator('.fx-region[data-region="body"]')).toHaveText('Loads quickly');
    // the icon slot, filled with the basic diamond from the inspector
    const slot = editor.panel('Inspector').getByRole('textbox', { name: 'Icon shape for icon' });
    await slot.fill('basic:diamond');
    await slot.press('Enter');
    await expect(card.locator('svg.fx-icon-slot[data-slot="icon"] path')).toHaveCount(1);
    // the body region runs 0.06..0.94 across and 0.38..0.78 down: a double-click in it opens that region alone
    await page.mouse.dblclick(at.x + at.width / 2, at.y + at.height * 0.58);
    await expect(open).toBeVisible();
    await page.keyboard.type('Loads in a blink');
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect(card.locator('.fx-region[data-region="body"]')).toHaveText('Loads in a blink');
    await expect(card.locator('.fx-region[data-region="caption"]')).toHaveCount(0);
    await expect(title).toHaveText('Fast');
    await expectAccessible();
    // one undo step takes the body text back, the icon kept
    await page.keyboard.press('ControlOrMeta+z');
    await expect(card.locator('.fx-region[data-region="body"]')).toHaveText('Loads quickly');
    await expect(title).toHaveText('Fast');
    await expect(card.locator('svg.fx-icon-slot')).toHaveCount(1);
  });
});
