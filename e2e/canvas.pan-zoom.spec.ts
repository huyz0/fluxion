import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** Ctrl + wheel `times` times at the canvas centre (a trackpad pinch arrives the same way). */
async function pinch(editor: EditorPage, deltaY: number, times: number): Promise<void> {
  const c = await editor.canvasCentre();
  await editor.page.mouse.move(c.x, c.y);
  await editor.page.keyboard.down('Control');
  for (let i = 0; i < times; i++) await editor.page.mouse.wheel(0, deltaY);
  await editor.page.keyboard.up('Control');
}

// wheel and mouse buttons: desktop input (touch pan and pinch: touch.edit-basics.spec.ts)
test.describe('canvas pan and zoom', { tag: '@desktop' }, () => {
  test('FR-EDT-002: zoom clamps to 5 % and 3200 %', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await pinch(editor, -400, 12);
    await expect(editor.zoomValue).toHaveText('3200 %');
    await expect(editor.zoomButton('Zoom in')).toBeDisabled();
    expect((await editor.screenBox()).width).toBeCloseTo(1920 * 32, 0);
    await page.keyboard.press('Control+Equal');
    await expect(editor.zoomValue).toHaveText('3200 %');
    await pinch(editor, 400, 20);
    await expect(editor.zoomValue).toHaveText('5 %');
    await expect(editor.zoomButton('Zoom out')).toBeDisabled();
    expect((await editor.screenBox()).width).toBeCloseTo(1920 * 0.05, 0);
  });

  test('FR-EDT-002: zooming keeps the point under the cursor still', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const before = await editor.screenBox();
    // a point inside the screen, off its centre, on whole pixels (a wheel event's clientX is an integer)
    const at = { x: Math.round(before.x + before.width * 0.3), y: Math.round(before.y + before.height * 0.7) };
    const pageX = ((at.x - before.x) / before.width) * 1920;
    const pageY = ((at.y - before.y) / before.height) * 1080;
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await editor.screenBox()).width).toBeGreaterThan(before.width * 1.5);
    const after = await editor.screenBox();
    expect(((at.x - after.x) / after.width) * 1920).toBeCloseTo(pageX, 0);
    expect(((at.y - after.y) / after.height) * 1080).toBeCloseTo(pageY, 0);
  });

  test('FR-EDT-002: the wheel, space-drag and middle-drag pan the screen', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const c = await editor.canvasCentre();
    await page.mouse.move(c.x, c.y);
    const start = await editor.screenBox();
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await editor.screenBox()).y).toBeLessThan(start.y);
    const wheeled = await editor.screenBox();
    expect(wheeled.x).toBeCloseTo(start.x, 0);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(c.x + 50, c.y + 30, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const dragged = await editor.screenBox();
    expect(dragged.x - wheeled.x).toBeCloseTo(50, 0);
    expect(dragged.y - wheeled.y).toBeCloseTo(30, 0);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(c.x + 10, c.y + 60, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    const middle = await editor.screenBox();
    expect(middle.x - dragged.x).toBeCloseTo(-40, 0);
    expect(middle.y - dragged.y).toBeCloseTo(30, 0);
    // a plain drag does not pan (it belongs to the tools)
    await page.mouse.down();
    await page.mouse.move(c.x + 100, c.y + 100, { steps: 3 });
    await page.mouse.up();
    expect(await editor.screenBox()).toEqual(middle);
  });

  test('FR-EDT-002: shortcuts and buttons go to 100 %, fit and step the zoom', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const fitted = await editor.zoomValue.textContent();
    await editor.canvas.click({ button: 'middle' });
    await page.keyboard.press('Shift+Digit0');
    await expect(editor.zoomValue).toHaveText('100 %');
    expect((await editor.screenBox()).width).toBeCloseTo(1920, 0);
    await page.keyboard.press('Shift+Digit1');
    await expect(editor.zoomValue).toHaveText(fitted ?? '');
    await page.keyboard.press('Control+Minus');
    await editor.zoomButton('Zoom in').click();
    await expect(editor.zoomValue).toHaveText(fitted ?? '');
    await editor.zoomButton('100 %').click();
    await expect(editor.zoomValue).toHaveText('100 %');
    await editor.zoomButton('Fit').click();
    await expect(editor.zoomValue).toHaveText(fitted ?? '');
  });

  test('FR-EDT-002: shift + 2 and the toolbar control fit the selection in the canvas', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    await expect(editor.zoomButton('Zoom to selection')).toBeDisabled();
    // select the first row's rectangle and rounded rectangle (page x 80-520, y 60-170) with a marquee
    const screen = await editor.screenBox();
    const scale = screen.width / 1920;
    await page.mouse.move(screen.x + 60 * scale, screen.y + 40 * scale);
    await page.mouse.down();
    await page.mouse.move(screen.x + 540 * scale, screen.y + 190 * scale, { steps: 6 });
    await page.mouse.up();
    await expect(editor.inspectorText).toHaveText('2 elements selected');
    const canvas = await editor.canvas.boundingBox();
    if (canvas === null) throw new Error('no canvas');
    // fitted: the selection's centre (300, 115) at the canvas centre, its 440 px width filling the
    // canvas less the 32 px padding on each side (it is the tighter side)
    const expectFitted = async () => {
      await expect.poll(async () => (await editor.screenBox()).width / 1920).toBeCloseTo((canvas.width - 64) / 440, 2);
      const s = await editor.screenBox();
      const z = s.width / 1920;
      expect(s.x + 300 * z).toBeCloseTo(canvas.x + canvas.width / 2, 0);
      expect(s.y + 115 * z).toBeCloseTo(canvas.y + canvas.height / 2, 0);
    };
    await page.keyboard.press('Shift+Digit2');
    await expectFitted();
    await page.keyboard.press('Shift+Digit1');
    await expect.poll(async () => (await editor.screenBox()).width).toBeCloseTo(screen.width, 0);
    await editor.zoomButton('Zoom to selection').click();
    await expectFitted();
  });
});
