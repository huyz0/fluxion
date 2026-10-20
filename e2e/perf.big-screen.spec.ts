import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { expect, test } from './test.js';

// NFR-PERF-002: a screen of 2,000 elements and 1,000 connectors (fixtures/docs/perf-2k-1k.flux.json, opened as a file: it is too big to bundle with the studio
// as an example) is drawn in the editor within BIG_SCREEN_FIRST_RENDER_MS of picking the file, and panning and zooming it keep BIG_SCREEN_PANZOOM_MIN_FPS. It runs
// in the `perf` project (chromium, one worker, nothing beside it, @perf): the times are wall clocks.

/** A bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
function threshold(name: string): number {
  const text = readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8');
  return Number(new RegExp(`${name}: \\{ value: ([\\d_.]+)`).exec(text)?.[1]?.replaceAll('_', ''));
}
const FIRST_RENDER_MS = threshold('BIG_SCREEN_FIRST_RENDER_MS');
const PANZOOM_MIN_FPS = threshold('BIG_SCREEN_PANZOOM_MIN_FPS');

/** The tasks past 50 ms, in ms, reported while `during` runs (the browser reports no others). */
async function longTasksDuring(page: Page, during: () => Promise<void>): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration);
    }).observe({ type: 'longtask' });
  });
  await during();
  // the observer reports on the next turn of the event loop
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
}

const SHAPES = 2000;
const CONNECTORS = 1000;

test.use({ trace: 'off' });

/** Start counting animation frames; the returned function stops and gives their timestamps. */
async function recordFrames(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { frames: number[]; recording: boolean };
    w.frames = [];
    w.recording = true;
    const tick = (t: number) => {
      if (!w.recording) return;
      w.frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { frames: number[]; recording: boolean };
      w.recording = false;
      return w.frames;
    });
}

/** At least a second's worth of frames (60 at 60 Hz), at PANZOOM_MIN_FPS or better on average, and the longest gap between two. */
function expectRate(frames: number[], what: string): void {
  expect(frames.length).toBeGreaterThanOrEqual(60);
  const seconds = ((frames.at(-1) as number) - (frames[0] as number)) / 1000;
  const fps = (frames.length - 1) / seconds;
  test.info().annotations.push({ type: `${what} fps`, description: fps.toFixed(1) });
  expect(fps, `${what}: ${fps.toFixed(1)} fps over ${frames.length} frames`).toBeGreaterThanOrEqual(PANZOOM_MIN_FPS);
}

const FILE = asPicker('perf-2k-1k.flux.json', readFileSync(new URL('../fixtures/docs/perf-2k-1k.flux.json', import.meta.url)));

/** Pick the big file in the studio's start page and wait until every shape and connector of its screen is drawn; the milliseconds from the click. */
async function open(page: Page, editor: EditorPage): Promise<number> {
  await page.goto('/');
  const start = Date.now();
  await page.getByRole('button', { name: 'Open a file…' }).click();
  await expect(editor.canvas.locator('svg.fx-connector')).toHaveCount(CONNECTORS, { timeout: 20_000 });
  await expect(editor.elements).toHaveCount(SHAPES + CONNECTORS);
  return Date.now() - start;
}

/** The first render, the best of three opens (the first pays for a cold page). */
async function firstRenderMs(page: Page, editor: EditorPage): Promise<number> {
  const times: number[] = [];
  for (let run = 0; run < 3; run++) times.push(await open(page, editor));
  return Math.min(...times);
}

test.describe('big-screen performance', { tag: '@perf' }, () => {
  test('NFR-PERF-002: a screen of 2,000 elements and 1,000 connectors is drawn within BIG_SCREEN_FIRST_RENDER_MS', async ({ page }) => {
    expect(FIRST_RENDER_MS).toBe(1000);
    const editor = new EditorPage(page);
    await pickers(page, FILE);
    const ms = await firstRenderMs(page, editor);
    test.info().annotations.push({ type: 'first render ms', description: String(ms) });
    expect(ms, `drawn after ${ms} ms`).toBeLessThanOrEqual(FIRST_RENDER_MS);
  });

  test('NFR-PERF-002: panning and zooming that screen keep BIG_SCREEN_PANZOOM_MIN_FPS', async ({ page }) => {
    expect(PANZOOM_MIN_FPS).toBe(50);
    const editor = new EditorPage(page);
    await pickers(page, FILE);
    await open(page, editor);
    const box = await editor.canvas.boundingBox();
    if (box === null) throw new Error('no canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // the camera's transform on the screen: the frames count only if the wheel moved it
    const screen = editor.canvas.locator('.fx-screen').first();
    const transform = () => screen.evaluate((el) => (el as HTMLElement).style.transform);
    // pan: wheel without a modifier scrolls the camera, 90 steps
    const before = await transform();
    let stop = await recordFrames(page);
    for (let i = 0; i < 90; i++) await page.mouse.wheel(i % 30 < 15 ? 12 : -12, 8);
    expectRate(await stop(), 'pan');
    const panned = await transform();
    expect(panned).not.toBe(before);
    expect(panned).toMatch(/scale\(([\d.]+)\)/);
    const scale = (t: string) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1]);
    // zoom: wheel with Control zooms at the pointer, in (then out a little less, so it ends zoomed in)
    stop = await recordFrames(page);
    await page.keyboard.down('Control');
    for (let i = 0; i < 90; i++) await page.mouse.wheel(0, i < 50 ? -10 : 10);
    await page.keyboard.up('Control');
    expectRate(await stop(), 'zoom');
    expect(scale(await transform())).toBeGreaterThan(scale(panned));
  });

  test('FR-ANC-006: dragging a connector end across that screen, anchors shown and covered ones left out, leaves no main-thread task over 50 ms', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await pickers(page, FILE);
    await open(page, editor);
    const screen = await editor.screenBox();
    // a point of the 3840 × 2160 screen on the page; shape k (column k % 50, row k / 50) has its centre at (65 + 75 col, 56 + 52 row)
    const on = (x: number, y: number) => ({ x: screen.x + (x * screen.width) / 3840, y: screen.y + (y * screen.height) / 2160 });
    await editor.toolButton('Connector').click();
    const from = on(65, 56);
    const to = on(65 + 75 * 30, 56 + 52 * 20);
    await page.mouse.move(from.x, from.y);
    // the hit index is built when the page is first idle after the open (or by the first query): wait for an idle turn so its build is not the drag's
    await page.evaluate(() => new Promise<void>((done) => requestIdleCallback(() => done(), { timeout: 2000 })));
    await page.mouse.down();
    // only the moves are measured: the press and the drop (which adds a connector to a 3,000-element screen) are one-off tasks of their own
    const tasks = await longTasksDuring(page, () => page.mouse.move(to.x, to.y, { steps: 80 }));
    await page.mouse.up();
    test.info().annotations.push({ type: 'long tasks ms', description: JSON.stringify(tasks) });
    // the drag made a connector, so it went through the tool and not past it
    await expect(editor.canvas.locator('svg.fx-connector')).toHaveCount(CONNECTORS + 1);
    expect(tasks, `long tasks while dragging: ${JSON.stringify(tasks)}`).toEqual([]);
  });
});
