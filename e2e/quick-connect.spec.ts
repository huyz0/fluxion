import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

type Box = { x: number; y: number; width: number; height: number };

// hover and the pointer: desktop input
test.describe('quick-connect', { tag: '@desktop' }, () => {
  test('FR-EDT-015: the east "+" of a hovered shape, dragged to empty canvas, adds a bound connector and a shape from the mini library', async ({
    page,
    expectAccessible,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const screen = await editor.screenBox();
    await editor.toolButton('Shape').click();
    await page.mouse.click(screen.x + screen.width * 0.25, screen.y + screen.height * 0.4);
    await expect(editor.shapes).toHaveCount(1);
    // nothing selected: a selected shape shows its frame's handles instead
    await editor.toolButton('Select').click();
    await page.mouse.click(screen.x + screen.width * 0.9, screen.y + screen.height * 0.9);
    const shape = (await editor.shapes.first().boundingBox()) as Box;
    await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
    const plus = editor.canvas.locator('[data-quick-connect="e"]');
    await expect(editor.canvas.locator('[data-quick-connect]')).toHaveCount(4);
    const east = (await plus.boundingBox()) as Box;
    const from = { x: east.x + east.width / 2, y: east.y + east.height / 2 };
    // onto the "+" (the shape stays hovered), then dragged right onto empty canvas
    await page.mouse.move(from.x, from.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y, { steps: 6 });
    await page.mouse.move(from.x + 240, from.y, { steps: 6 });
    await page.mouse.up();
    // in the editor's root, where the chrome's colours and focus ring apply, and drawn on a background
    const library = editor.root.getByRole('menu', { name: 'Add a shape', exact: true });
    await expect(library).toBeVisible();
    expect(await library.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await expectAccessible();
    await library.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
    await expect(editor.shapes).toHaveCount(2);
    const connectors = editor.canvas.locator('.fx-el[data-kind="connector"]');
    await expect(connectors).toHaveCount(1);
    // the new shape starts where the drag ended, right of the first
    const added = (await editor.shapes.nth(1).boundingBox()) as Box;
    expect(added.x).toBeGreaterThan(shape.x + shape.width);
    await expectAccessible();
    // the connector and the shape are one undo step
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.shapes).toHaveCount(1);
    await expect(connectors).toHaveCount(0);
  });
});
