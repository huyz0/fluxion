import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/**
 * Fire a paste event at the page carrying `what`: text, and/or an image file drawn in the page (a real PNG). The system
 * clipboard cannot be filled with a picture from a test, but the event is what the browser fires for Ctrl/Cmd+V.
 */
async function paste(page: Page, what: { text?: string; image?: { w: number; h: number } }): Promise<void> {
  await page.evaluate(async ({ text, image }) => {
    const data = new DataTransfer();
    if (text !== undefined) data.setData('text/plain', text);
    if (image !== undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = image.w;
      canvas.height = image.h;
      const g = canvas.getContext('2d');
      if (g) {
        g.fillStyle = '#c0392b';
        g.fillRect(0, 0, image.w, image.h);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      data.items.add(new File([blob as Blob], 'pasted.png', { type: 'image/png' }));
    }
    // a plain event carrying the data: Firefox does not take `clipboardData` in a ClipboardEvent's init
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    document.body.dispatchEvent(event);
  }, what);
}

// keyboard-like events and a double-click: desktop input
test.describe('pasting what is not Fluxion`s', { tag: '@desktop' }, () => {
  test('FR-TXT-003: a pasted text element opens in the inline editor', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await paste(page, { text: 'Pasted line one\nline two' });
    const pasted = editor.canvas.locator('.fx-el[data-kind="text"]');
    await expect(pasted).toHaveCount(1);
    await expect(pasted.locator('.fx-label p')).toHaveText(['Pasted line one', 'line two']);
    // selected, one undo step
    await expect(editor.inspectorText).toHaveText('1 element selected');
    // a double-click opens it in the inline editor, and typing replaces its text
    const box = await pasted.boundingBox();
    if (box === null) throw new Error('the text element is not drawn');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 12);
    await expect(editor.canvas.getByTestId('text-editor')).toBeVisible();
    await page.keyboard.type('Edited');
    await page.keyboard.press('Escape');
    await expect(pasted.locator('.fx-label')).toHaveText('Edited');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(pasted.locator('.fx-label p')).toHaveText(['Pasted line one', 'line two']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements).toHaveCount(0);
  });

  test('FR-EDT-007: a pasted image becomes an image element that draws, in one undo step', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await paste(page, { image: { w: 600, h: 300 } });
    const image = editor.canvas.locator('.fx-el[data-kind="image"]');
    await expect(image).toHaveCount(1);
    // drawn from the bytes the editor holds: the picture decoded
    const href = (await image.locator('image.fx-image').getAttribute('href')) ?? '';
    expect(href.startsWith('data:image/png;base64,')).toBe(true);
    expect(
      await page.evaluate(
        (src) =>
          new Promise<number>((resolve) =>
            Object.assign(new Image(), {
              onload() {
                resolve((this as unknown as HTMLImageElement).naturalWidth);
              },
              onerror() {
                resolve(0);
              },
              src,
            }),
          ),
        href,
      ),
    ).toBe(600);
    const screen = await editor.screenBox();
    const box = await image.boundingBox();
    // fitted to 480 px on its long side, at the screen's scale
    expect((box?.width ?? 0) / (screen.width / 1920)).toBeCloseTo(480, -1);
    expect((box?.height ?? 0) / (screen.width / 1920)).toBeCloseTo(240, -1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.elements).toHaveCount(0);
  });

  test('NFR-SEC-001: a pasted SVG is sanitised: its script and handlers never reach the page', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const errors: string[] = [];
    page.on('dialog', (d) => {
      errors.push(d.message());
      void d.dismiss();
    });
    await paste(page, {
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30" onload="alert(1)"><script>alert(2)</script><rect width="60" height="30" fill="#2980b9"/></svg>',
    });
    const image = editor.canvas.locator('.fx-el[data-kind="image"]');
    await expect(image).toHaveCount(1);
    const src = await image.locator('image.fx-image').getAttribute('href');
    expect(src?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const markup = Buffer.from((src ?? '').split(',')[1] ?? '', 'base64').toString('utf8');
    expect(markup).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="#2980b9"></rect></svg>');
    expect(errors).toEqual([]);
  });
});
