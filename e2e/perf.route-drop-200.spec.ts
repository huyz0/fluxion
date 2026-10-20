import { readFileSync } from 'node:fs';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The global routing pass on drop (FR-RTE-003, ADR-0044): the hub of the perf-route-200 example is dragged and dropped; once the document
// settles, the studio's routing worker routes the 200 orthogonal connectors as one batch and the editor draws those routes. The page's main
// thread stays free while it does: no long task (the browser reports one past 50 ms) from the drop until every connector shows the global
// route. The search is bounded, so a connector it gives up on keeps its cheap route: at least GLOBAL of the 200 must get the global one. It
// runs in the `perf` project (chromium), one worker (@perf).

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/docs/perf-route-200.flux.json', import.meta.url), 'utf8')) as {
  records: Record<string, { type: string; kind?: string; semantic?: { slug?: string } }>;
};
const HUB = Object.entries(FIXTURE.records).find(([, r]) => r.semantic?.slug === 'drag-me')?.[0] as string;

/** Connectors that must show the global route (the bounded A* may give up on a few among 200 shapes; their cheap route stands). */
const GLOBAL = 190;

test.use({ trace: 'off' });

test.describe('global routing performance', { tag: '@perf' }, () => {
  test('FR-RTE-003: after a drop the global routes of 200 connectors arrive with no main-thread task over 50 ms', async ({ page }) => {
    const editor = new EditorPage(page);
    // the global routes are drawn by default (M16.28)
    await page.goto('/edit/example-perf-route-200');
    await editor.screens.first().waitFor();
    const passes = editor.canvas.locator('svg.fx-connector[data-route-pass="global"]');
    // the pass also runs once the opened document settles
    await expect.poll(() => passes.count()).toBeGreaterThanOrEqual(GLOBAL);
    const hub = editor.element(HUB);
    const start = await hub.boundingBox();
    if (start === null) throw new Error('the hub is not drawn');
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(from.x + 3 * i, from.y + i);
    // during the drag every connector draws the cheap pass (the change cleared the global routes)
    await expect.poll(() => passes.count()).toBe(0);
    await page.evaluate(() => {
      const w = window as unknown as { longTasks: number[] };
      w.longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.longTasks.push(e.duration);
      }).observe({ type: 'longtask' });
    });
    await page.mouse.up();
    // waited inside the page: Playwright's polling would be a task of the page too
    await page.evaluate(
      (least) =>
        new Promise<void>((done) => {
          const timer = setInterval(() => {
            if (document.querySelectorAll('main[aria-label="Canvas"] svg.fx-connector[data-route-pass="global"]').length >= least) {
              clearInterval(timer);
              done();
            }
          }, 50);
        }),
      GLOBAL,
    );
    await page.waitForTimeout(500);
    const tasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
    expect(
      tasks.map((ms) => ms.toFixed(0)),
      'main-thread tasks over 50 ms (ms)',
    ).toEqual([]);
  });
});
