import { readFileSync } from 'node:fs';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The connector drag benchmark (FR-RTE-002, 05 §8): the hub of the perf-route-200 example
// (fixtures/docs/perf-route-200.flux.json) dragged with its 200 orthogonal connectors, frames measured with
// requestAnimationFrame while the pointer moves. It runs in the `perf` project (chromium), one worker (@perf).

/** The bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
const ROUTE_DRAG_200_MIN_FPS = Number(
  /ROUTE_DRAG_200_MIN_FPS: \{ value: ([\d.]+)/.exec(readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8'))?.[1],
);

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/docs/perf-route-200.flux.json', import.meta.url), 'utf8')) as {
  records: Record<string, { type: string; kind?: string; semantic?: { slug?: string } }>;
};
const HUB = Object.entries(FIXTURE.records).find(([, r]) => r.semantic?.slug === 'drag-me')?.[0] as string;

// tracing snapshots the DOM at every pointer move (200 connectors: ~2 ms of main thread each): it would be measured as app time
test.use({ trace: 'off' });

test.describe('connector drag performance', { tag: '@perf' }, () => {
  test('FR-RTE-002: dragging a shape with 200 connectors keeps at least ROUTE_DRAG_200_MIN_FPS over the measured frames', async ({ page }) => {
    expect(ROUTE_DRAG_200_MIN_FPS).toBe(50);
    expect(Object.values(FIXTURE.records).filter((r) => r.kind === 'connector')).toHaveLength(200);
    const editor = new EditorPage(page);
    await editor.open('example-perf-route-200');
    const hub = editor.element(HUB);
    const start = await hub.boundingBox();
    if (start === null) throw new Error('the hub is not drawn');
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
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
    expect(frames.length).toBeGreaterThanOrEqual(60);
    const fps = (frames.length - 1) / (((frames.at(-1) as number) - (frames[0] as number)) / 1000);
    expect(fps, `${fps.toFixed(1)} fps over ${frames.length} frames`).toBeGreaterThanOrEqual(ROUTE_DRAG_200_MIN_FPS);
    // the hub followed the pointer, 180 by 90 screen px, to within a snap's reach
    const end = await hub.boundingBox();
    expect(Math.abs((end?.x ?? 0) - start.x - 180)).toBeLessThanOrEqual(8);
    expect(Math.abs((end?.y ?? 0) - start.y - 90)).toBeLessThanOrEqual(8);
  });
});
