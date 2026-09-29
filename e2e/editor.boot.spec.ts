import { EditorPage } from './pages/editor.js';
import { StudioPage } from './pages/studio.js';
import { expect, test } from './test.js';

test('FR-EDT-001: /edit/new opens one empty 16:9 screen', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.open('new');
  await expect(editor.root).toBeVisible();
  await expect(editor.screens).toHaveCount(1);
  await expect(editor.elements).toHaveCount(0);
  const box = await editor.screens.first().boundingBox();
  expect(box).not.toBeNull();
  expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(16 / 9, 2);
});

test('FR-EDT-001: a fixture opens with its basic shapes drawn, no placeholder', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.open('example-shapes-gallery');
  // the gallery's 21 basic shapes and its 4 bound ones, each drawn by the bundled pack
  await expect(editor.shapes).toHaveCount(25);
  await expect(editor.placeholders).toHaveCount(0);
});

test('FR-EDT-001: the home page opens a new document; /present/new presents one', async ({ page }) => {
  const studio = new StudioPage(page);
  await studio.open();
  await page.getByRole('link', { name: 'New document' }).click();
  await expect(page).toHaveURL(/\/edit\/new$/);
  await expect(new EditorPage(page).root).toBeVisible();
  await page.goto('/present/new');
  await expect(page.getByTestId('player-root').locator('.fx-screen')).toHaveCount(1);
  // an unknown document says why instead of failing silently
  await page.goto('/edit/nope');
  await expect(page.getByRole('alert')).toContainText('There is no document "nope"');
});
