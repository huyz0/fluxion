import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The gallery's first shape: a filled rectangle. */
const RECT = 'SvJFIk0oCSKcTo6X';

// a mouse click and drag: desktop input (touch editing: touch.edit-basics.spec.ts)
test.describe('select and hand tools', { tag: '@desktop' }, () => {
  test('FR-EDT-003: the select tool selects the shape under a click and clears on empty canvas', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
    // edit-mode content takes no pointer events (the canvas does): click where the shape is drawn
    const rect = await editor.element(RECT).boundingBox();
    if (rect === null) throw new Error('the rectangle is not drawn');
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(editor.inspectorText).toHaveText('1 element selected');
    const screen = await editor.screenBox();
    // below the screen: nothing is drawn there
    await page.mouse.click(screen.x + screen.width / 2, screen.y + screen.height + 20);
    await expect(editor.inspectorText).toHaveText('Select an element to see its properties.');
  });

  test('FR-EDT-003: H picks the hand, which drags the page; Esc returns to select', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await editor.canvas.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('h');
    await expect(editor.toolButton('Hand')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'false');
    const before = await editor.screenBox();
    const c = await editor.canvasCentre();
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 40, c.y + 25, { steps: 3 });
    await page.mouse.up();
    const after = await editor.screenBox();
    expect(after.x - before.x).toBeCloseTo(40, 0);
    expect(after.y - before.y).toBeCloseTo(25, 0);
    // the hand selects nothing
    await expect(editor.inspectorText).toHaveText('Select an element to see its properties.');
    await page.keyboard.press('Escape');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
    // Esc in select stays in select; V and the buttons switch too
    await page.keyboard.press('Escape');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
    await editor.toolButton('Hand').click();
    await expect(editor.toolButton('Hand')).toHaveAttribute('aria-pressed', 'true');
    await editor.canvas.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('v');
    await expect(editor.toolButton('Select')).toHaveAttribute('aria-pressed', 'true');
  });
});
