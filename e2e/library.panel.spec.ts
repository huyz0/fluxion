import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// typing in the search box and the panel's tabs: desktop input
test.describe('library panel', { tag: '@desktop' }, () => {
  test('FR-LIB-001: the library lists the packs by their names and category, and searching `database` finds the cylinder and the database icons', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    // the basic pack, by the name its index gives, under its category heading, with a thumbnail and a name for each shape
    const items = left.locator('.fx-chrome-library-item');
    await expect(left.getByRole('region', { name: 'Pack Basic shapes' })).toBeVisible();
    await expect(left.getByRole('heading', { name: 'Basic shapes / basic' })).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(15);
    await expect(left.getByRole('region', { name: 'Pack Basic shapes' }).locator('.fx-chrome-library-item').first().locator('svg path')).toHaveCount(1);
    await expect(left.locator('[data-def-id="basic:cylinder"]')).toContainText('Cylinder');
    // a keyword finds the shapes that carry it, in every pack: the cylinder and the database icons (FR-LIB-001's acceptance)
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('database');
    await expect(left.locator('[data-def-id="basic:cylinder"]')).toBeVisible();
    await expect(left.locator('[data-def-id="cloud:database"]')).toBeVisible();
    await expect(left.locator('[data-def-id="lucide:database"]')).toBeVisible();
    // nothing matches: an empty list, and clearing the box brings everything back
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('zzzz');
    await expect(items).toHaveCount(0);
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('');
    expect(await items.count()).toBeGreaterThanOrEqual(15);
  });

  test('FR-LIB-007, FR-LIB-009: every first-party pack is listed before its geometry loads, and a picked shape is loaded and drawn', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    const editor = new EditorPage(page);
    await editor.open('new');
    const left = editor.panel('Screens, library and layers');
    await left.getByRole('tab', { name: 'Library', exact: true }).click();
    for (const name of [
      'Arrows',
      'BPMN-lite',
      'Callouts',
      'Cloud architecture',
      'Devices',
      'Flowchart',
      'Lucide icons',
      'Infographic',
      'Network',
      'People',
      'UML',
    ])
      await expect(left.getByRole('region', { name: `Pack ${name}` })).toBeVisible();
    // listed and searched by the index alone: the laptop's tile is empty until its geometry is loaded
    await left.getByRole('searchbox', { name: 'Search the library' }).fill('laptop');
    const laptop = left.locator('[data-def-id="devices:laptop"]');
    await expect(laptop).toContainText('Laptop');
    await expect(laptop.locator('svg path')).toHaveCount(0);
    await laptop.getByRole('button').click();
    // picked: the definition is loaded and registered, the shape inserted, and the tile drawn from its outline
    const laptops = () =>
      page.evaluate(
        () =>
          Object.values((window as unknown as { __fluxion: { records(): Record<string, Record<string, unknown>> } }).__fluxion.records()).filter(
            (r) => r['defId'] === 'devices:laptop',
          ).length,
      );
    await expect.poll(laptops).toBe(1);
    await expect(laptop.locator('svg path')).toHaveCount(1);
  });
});
