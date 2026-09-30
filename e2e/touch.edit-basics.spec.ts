import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// Touch editing on the phone projects (mobile-chrome, mobile-safari). Fingers are pointer events of
// type touch dispatched on the canvas: Playwright has no multi-touch on WebKit, and the editor reads
// pointer events alone.

type Point = { readonly x: number; readonly y: number };

/** A touch pointer event of finger `id` at `p` on the canvas. */
async function finger(
  canvas: Locator,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  { id, p }: { readonly id: number; readonly p: Point },
): Promise<void> {
  await canvas.dispatchEvent(type, {
    pointerType: 'touch',
    pointerId: id,
    isPrimary: id === 1,
    clientX: p.x,
    clientY: p.y,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' ? 0 : 1,
    bubbles: true,
    cancelable: true,
  });
}

/** One frame: moves are applied once per animation frame. */
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** A finger dragged from `a` to `b` in four moves, one per frame. */
async function drag(page: Page, canvas: Locator, a: Point, b: Point): Promise<void> {
  const steps = 4;
  await finger(canvas, 'pointerdown', { id: 1, p: a });
  for (let s = 1; s <= steps; s++) {
    await finger(canvas, 'pointermove', { id: 1, p: { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps } });
    await frame(page);
  }
  await finger(canvas, 'pointerup', { id: 1, p: b });
}

/** A tap at `p`. */
async function tap(canvas: Locator, p: Point): Promise<void> {
  await finger(canvas, 'pointerdown', { id: 1, p });
  await finger(canvas, 'pointerup', { id: 1, p });
}

// fingers: the phone projects' input (desktops run the mouse specs)
test.describe('touch editing', { tag: '@mobile' }, () => {
  test('FR-EDT-019: tap selects, a drag moves, a handle resizes; the canvas has the phone`s width', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    // a first visit on a phone: side panels collapsed, the canvas all but the width
    const canvasBox = await editor.canvas.boundingBox();
    expect(canvasBox?.width ?? 0).toBeGreaterThan((page.viewportSize()?.width ?? 0) - 16);
    const frameOutline = page.locator('svg.fx-chrome-overlay polygon.fx-chrome-frame');
    // a shape placed with the shape tool and a tap
    await editor.toolButton('Shape').click();
    const c = await editor.canvasCentre();
    await tap(editor.canvas, c);
    await expect(editor.shapes).toHaveCount(1);
    await expect(frameOutline).toHaveCount(1);
    // a tap on nothing clears the selection; a tap on the shape selects it
    const screen = await editor.screenBox();
    await tap(editor.canvas, { x: screen.x + 4, y: screen.y + 4 });
    await expect(frameOutline).toHaveCount(0);
    await tap(editor.canvas, c);
    await expect(frameOutline).toHaveCount(1);
    // a drag moves it by as much
    const before = await editor.shapes.first().boundingBox();
    if (before === null) throw new Error('the shape is not drawn');
    await drag(page, editor.canvas, c, { x: c.x + 30, y: c.y + 20 });
    await expect.poll(async () => (await editor.shapes.first().boundingBox())?.x).toBeCloseTo(before.x + 30, 0);
    const moved = await editor.shapes.first().boundingBox();
    if (moved === null) throw new Error('the shape is not drawn');
    expect(moved.y).toBeCloseTo(before.y + 20, 0);
    // a finger 15 px beyond the bottom-right handle still takes it (a mouse's reach is 8 px)
    const corner = { x: moved.x + moved.width + 15, y: moved.y + moved.height };
    await drag(page, editor.canvas, corner, { x: corner.x + 40, y: corner.y });
    await expect.poll(async () => (await editor.shapes.first().boundingBox())?.width).toBeCloseTo(moved.width + 40, 0);
  });

  test('FR-EDT-019: two fingers pan and pinch-zoom the page', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const width = async () => (await editor.screenBox()).width;
    const start = await width();
    const c = await editor.canvasCentre();
    const a = { x: c.x - 40, y: c.y };
    const b = { x: c.x + 40, y: c.y };
    await finger(editor.canvas, 'pointerdown', { id: 1, p: a });
    await finger(editor.canvas, 'pointerdown', { id: 2, p: b });
    // spread twice as far apart: twice the zoom
    for (let s = 1; s <= 4; s++) {
      await finger(editor.canvas, 'pointermove', { id: 1, p: { x: a.x - 10 * s, y: a.y } });
      await finger(editor.canvas, 'pointermove', { id: 2, p: { x: b.x + 10 * s, y: b.y } });
      await frame(page);
    }
    await expect.poll(width).toBeCloseTo(start * 2, 0);
    await finger(editor.canvas, 'pointerup', { id: 1, p: a });
    await finger(editor.canvas, 'pointerup', { id: 2, p: b });
    // both fingers moved together pan the page with them
    const before = await editor.screenBox();
    await finger(editor.canvas, 'pointerdown', { id: 1, p: a });
    await finger(editor.canvas, 'pointerdown', { id: 2, p: b });
    await finger(editor.canvas, 'pointermove', { id: 1, p: { x: a.x + 30, y: a.y + 25 } });
    await finger(editor.canvas, 'pointermove', { id: 2, p: { x: b.x + 30, y: b.y + 25 } });
    await frame(page);
    await finger(editor.canvas, 'pointerup', { id: 1, p: a });
    await finger(editor.canvas, 'pointerup', { id: 2, p: b });
    const after = await editor.screenBox();
    expect(after.x - before.x).toBeCloseTo(30, 0);
    expect(after.y - before.y).toBeCloseTo(25, 0);
    expect(await width()).toBeCloseTo(start * 2, 0);
  });

  test('FR-EDT-019: a finger held still asks for the context menu', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await page.evaluate(() => {
      window.addEventListener('fx-contextmenu', (e) => {
        (window as unknown as { asked: unknown }).asked = (e as CustomEvent).detail;
      });
    });
    const c = await editor.canvasCentre();
    await finger(editor.canvas, 'pointerdown', { id: 1, p: c });
    await expect.poll(() => page.evaluate(() => (window as unknown as { asked?: { screen: Point } }).asked?.screen ?? null)).not.toBeNull();
    await finger(editor.canvas, 'pointerup', { id: 1, p: c });
  });
});
