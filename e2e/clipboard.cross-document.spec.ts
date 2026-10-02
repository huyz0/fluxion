import { joinedPair } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// keys and tabs: desktop input
test.describe('copy and paste across documents', { tag: '@desktop' }, () => {
  test('FR-EDT-007: a pasted connector stays bound to the pasted shapes, in another document and tab', async ({ page, context }) => {
    const first = new EditorPage(page);
    await joinedPair(page, first);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    // another tab of the same browser: a new document
    const other = await context.newPage();
    const second = new EditorPage(other);
    await second.open('new');
    await expect(second.elements).toHaveCount(0);
    await other.bringToFront();
    await other.keyboard.press('ControlOrMeta+v');
    await expect(second.elements).toHaveCount(3);
    await expect(second.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    // bound: moving a pasted shape drags the connector with it
    const line = second.canvas.locator('.fx-el[data-kind="connector"] svg').first();
    const before = await line.boundingBox();
    await other.keyboard.press('Escape');
    const shape = await second.canvas.locator('.fx-el[data-kind="shape"]').first().boundingBox();
    if (shape === null || before === null) throw new Error('nothing drawn');
    await other.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await other.keyboard.press('Shift+ArrowDown');
    await other.keyboard.press('Shift+ArrowDown');
    await expect.poll(async () => (await line.boundingBox())?.height ?? 0).not.toBe(before.height);
  });

  test('FR-EDT-007: a keyboard copy then a menu Paste in chromium pastes the same shapes', async ({ page, context, browserName }) => {
    // the async clipboard read needs a grant, and the custom path is Chromium's (webkit keeps custom types per origin)
    // (the row asks for Chromium; the other engines pass this test without running it, the keyboard path above covers them)
    if (browserName !== 'chromium') return;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const first = new EditorPage(page);
    await joinedPair(page, first);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    const other = await context.newPage();
    const second = new EditorPage(other);
    await second.open('new');
    await other.bringToFront();
    await other.getByRole('button', { name: 'Paste', exact: true }).click();
    await expect(second.elements).toHaveCount(3);
    await expect(second.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
  });
});
