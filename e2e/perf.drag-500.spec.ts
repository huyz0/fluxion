import { readFileSync } from 'node:fs';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The drag benchmark (NFR-PERF-001, 04 §5): one element dragged among the 500 of the perf-500 example
// (fixtures/docs/perf-500.flux.json), frames measured with requestAnimationFrame while the pointer
// moves. It runs in its own project (`perf`, chromium) with one worker, nothing beside it (@perf).

/** The bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
const EDITOR_DRAG_MIN_FPS = Number(
  /EDITOR_DRAG_MIN_FPS: \{ value: ([\d.]+)/.exec(readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8'))?.[1],
);

/** The fixture's element slugged `drag-me`, in the middle of the grid. */
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/docs/perf-500.flux.json', import.meta.url), 'utf8')) as {
  records: Record<string, { type: string; semantic?: { slug?: string } }>;
};
const TARGET = Object.entries(FIXTURE.records).find(([, r]) => r.semantic?.slug === 'drag-me')?.[0] as string;

test.describe('drag performance', { tag: '@perf' }, () => {
  test('NFR-PERF-001: dragging one element among 500 keeps at least EDITOR_DRAG_MIN_FPS over the measured frames', async ({ page }) => {
    expect(EDITOR_DRAG_MIN_FPS).toBe(55);
    expect(TARGET).toBeDefined();
    const editor = new EditorPage(page);
    await editor.open('example-perf-500');
    await expect(editor.elements).toHaveCount(500);
    const target = editor.element(TARGET);
    const start = await target.boundingBox();
    if (start === null) throw new Error('the element to drag is not drawn');
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // frames from here on: every animation frame's timestamp while the pointer moves
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
    for (let i = 1; i <= 90; i++) await page.mouse.move(from.x + 2 * i, from.y + i);
    const frames = await page.evaluate(() => {
      const w = window as unknown as { frames: number[]; recording: boolean };
      w.recording = false;
      return w.frames;
    });
    await page.mouse.up();
    // the element followed the pointer: 180 by 90 canvas px
    const end = await target.boundingBox();
    expect((end?.x ?? 0) - start.x).toBeCloseTo(180, 0);
    expect((end?.y ?? 0) - start.y).toBeCloseTo(90, 0);
    // measured frames: at least a second's worth, at the minimum rate or better on average
    expect(frames.length).toBeGreaterThan(30);
    const seconds = ((frames.at(-1) as number) - (frames[0] as number)) / 1000;
    const fps = (frames.length - 1) / seconds;
    expect(fps, `${fps.toFixed(1)} fps over ${frames.length} frames`).toBeGreaterThanOrEqual(EDITOR_DRAG_MIN_FPS);
  });
});
