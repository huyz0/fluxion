import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// typing in the search box and the panel's tabs: desktop input
test.describe('library panel', { tag: '@desktop' }, () => {
  test('FR-LIB-001: the library lists the basic pack by category, and searching `database` narrows it to the cylinder', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    // the basic pack, under its category heading, with a thumbnail and a name for each shape
    const items = left.locator('.fx-chrome-library-item');
    await expect(left.getByRole('region', { name: 'Pack basic' })).toBeVisible();
    await expect(left.getByRole('heading', { name: 'basic / basic' })).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(15);
    await expect(items.first().locator('svg path')).toHaveCount(1);
    await expect(left.locator('[data-def-id="basic:cylinder"]')).toContainText('Cylinder');
    // a keyword finds the shape that carries it
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('database');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute('data-def-id', 'basic:cylinder');
    await expect(left.getByText('1 shape', { exact: true })).toBeVisible();
    // nothing matches: an empty list, and clearing the box brings everything back
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('zzzz');
    await expect(items).toHaveCount(0);
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('');
    expect(await items.count()).toBeGreaterThanOrEqual(15);
  });
});
