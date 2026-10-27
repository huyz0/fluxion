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

  test('FR-EDT-007, NFR-PORT-001: on an engine that raises clipboard events only from an editable field and refuses the async read, the keys still paste in another tab', async ({
    page,
    context,
  }) => {
    // WebKit 26.5 (M18.132, clipboard-events-probe in nightly 40470089950), on every engine: an event whose target takes no text never reaches the page, and a read is refused
    await context.addInitScript(() => {
      const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
      for (const type of ['copy', 'cut', 'paste'])
        window.addEventListener(type, (e) => (editable(e.target) ? undefined : e.stopImmediatePropagation()), { capture: true });
      const refused = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
      Object.defineProperty(navigator.clipboard, 'read', { value: refused });
      Object.defineProperty(navigator.clipboard, 'readText', { value: refused });
    });
    const first = new EditorPage(page);
    await joinedPair(page, first);
    // a text selection left on the page (a clicked canvas does not clear it) does not keep the chords from the catcher
    await first.zoomValue.evaluate((el) => getSelection()?.selectAllChildren(el));
    const shape = await first.canvas.locator('.fx-el[data-kind="shape"]').first().boundingBox();
    if (shape === null) throw new Error('nothing drawn');
    await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    const before = await focused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    // the focus and the page's selection are given back once the event is handled
    await expect.poll(focused).toBe(before);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(await first.zoomValue.textContent());
    const other = await context.newPage();
    const second = new EditorPage(other);
    await second.open('new');
    await other.bringToFront();
    await other.keyboard.press('ControlOrMeta+v');
    await expect(second.elements).toHaveCount(3);
    await expect(second.canvas.locator('.fx-el[data-kind="connector"]')).toHaveCount(1);
    // one press, one paste
    await other.waitForTimeout(400);
    await expect(second.elements).toHaveCount(3);
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
