import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { imageAssetsOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

/** A `File` of a JPEG `w` x `h` drawn in the page, as a handle the page keeps under `window.__image`. */
async function makeJpeg(page: Page, w: number, h: number): Promise<void> {
  await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      if (g) {
        const gradient = g.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, '#c0392b');
        gradient.addColorStop(1, '#2980b9');
        g.fillStyle = gradient;
        g.fillRect(0, 0, w, h);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      (window as unknown as { __image: File }).__image = new File([blob as Blob], 'big.jpg', { type: 'image/jpeg' });
    },
    { w, h },
  );
}

/** Drop the file `window.__image` (or `files`) on the canvas, as a drag from the desktop does. */
async function dropOnCanvas(page: Page, name: string, type: string, body?: string): Promise<void> {
  await page.evaluate(
    ({ name, type, body }) => {
      const data = new DataTransfer();
      const made = (window as unknown as { __image?: File }).__image;
      data.items.add(body === undefined && made !== undefined ? made : new File([body ?? ''], name, { type }));
      const canvas = document.querySelector('main[aria-label="Canvas"]') as HTMLElement;
      const r = canvas.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      canvas.dispatchEvent(new DragEvent('dragover', init));
      canvas.dispatchEvent(new DragEvent('drop', init));
    },
    { name, type, body },
  );
}

// drag and drop, pickers and a canvas: desktop input
test.describe('importing images', { tag: '@desktop' }, () => {
  test('FR-AST-001: dropping a 4000 px JPEG adds an image of at most 2560 px that renders, and the saved file embeds it', async ({ page }) => {
    await pickers(page, asPicker('x.flux', new Uint8Array()));
    const editor = new EditorPage(page);
    await editor.open('new');
    await makeJpeg(page, 4000, 3000);
    await dropOnCanvas(page, 'big.jpg', 'image/jpeg');
    await expect(editor.canvas.locator('.fx-el[data-kind="image"]')).toHaveCount(1);
    // it renders: the picture behind the element decoded, and is no larger than the import allows
    const size = await page.evaluate(async () => {
      const img = document.querySelector(
        'main[aria-label="Canvas"] .fx-el[data-kind="image"] image, main[aria-label="Canvas"] .fx-el[data-kind="image"] img',
      ) as SVGImageElement | HTMLImageElement | null;
      const href = img?.getAttribute('href') ?? img?.getAttribute('src') ?? '';
      const bitmap = await createImageBitmap(await (await fetch(href)).blob());
      return { w: bitmap.width, h: bitmap.height };
    });
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(2560);
    expect(size.w / size.h).toBeCloseTo(4 / 3, 1);
    // saved, the file holds one image asset with that size and its bytes
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const assets = await imageAssetsOf((await writes(page))[0]?.bytes ?? new Uint8Array());
    expect(assets).toHaveLength(1);
    expect(Math.max(assets[0]?.w ?? 0, assets[0]?.h ?? 0)).toBeLessThanOrEqual(2560);
    expect(assets[0]?.embedded).toBe(true);
  });

  test('FR-AST-001: a dropped file that is not an image is told to the person, and nothing is added', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dropOnCanvas(page, 'fake.png', 'image/png', 'this is text, not a picture');
    await expect(page.getByRole('status').filter({ hasText: 'fake.png' })).toBeVisible();
    await expect(editor.elements).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'fake.png' })).toHaveCount(0);
  });

  test("FR-AST-001: the image picker's file button imports a picture and places it", async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await editor.toolButton('Image').click();
    const box = await editor.canvasCentre();
    await page.mouse.move(box.x - 60, box.y - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
    await page.mouse.up();
    const picker = page.getByRole('dialog', { name: 'Choose an image' });
    await expect(picker).toBeVisible();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await picker.locator('input[type="file"]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
    await expect(picker).toHaveCount(0);
    await expect(editor.canvas.locator('.fx-el[data-kind="image"]')).toHaveCount(1);
  });
});
