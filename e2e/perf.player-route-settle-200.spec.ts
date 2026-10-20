import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// The one-file player's global routes (FR-RTE-003, ADR-0044 amendment M16.28): a .flux.html of the perf-route-200 example, opened from
// file://, draws the cheap routes at once and then the global routes the routing chunk's worker finds. The page's main thread stays free
// while it does: no long task (the browser reports one past 50 ms) after the first connectors are drawn, until the root says `settled`
// (performance.md rule 9). It runs in the `perf` project (chromium), one worker (@perf).

/** Connectors that must show the global route (the bounded A* may give up on a few among 200 shapes; their cheap route stands). */
const GLOBAL = 190;

test.use({ trace: 'off' });

test.describe('the player routes in a worker', { tag: '@perf' }, () => {
  test('FR-RTE-003: a .flux.html of 200 connectors settles its global routes with no main-thread task over 50 ms after the first paint', async ({
    page,
  }, info) => {
    const file = info.outputPath('perf-route-200.flux.html');
    writeFileSync(file, await fluxHtmlOf('perf-route-200'));
    await page.addInitScript(() => {
      const w = window as unknown as { longTasks: { start: number; ms: number }[]; drawn?: number };
      w.longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.longTasks.push({ start: e.startTime, ms: e.duration });
      }).observe({ type: 'longtask' });
      // the first paint of the connectors: the task that draws them is the opening's, not the routing's
      new MutationObserver((_, observer) => {
        if (document.querySelector('#fluxion-root svg.fx-connector') === null) return;
        w.drawn = performance.now();
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('#fluxion-root')).toHaveAttribute('data-routes', 'settled', { timeout: 30_000 });
    expect(await page.locator('#fluxion-root svg.fx-connector[data-route-pass="global"]').count()).toBeGreaterThanOrEqual(GLOBAL);
    await page.waitForTimeout(500);
    const { tasks, drawn } = await page.evaluate(() => {
      const w = window as unknown as { longTasks: { start: number; ms: number }[]; drawn?: number };
      return { tasks: w.longTasks, drawn: w.drawn };
    });
    expect(drawn, 'the connectors were drawn').toBeDefined();
    expect(
      tasks.filter((t) => t.start > (drawn ?? 0)).map((t) => t.ms.toFixed(0)),
      'main-thread tasks over 50 ms after the first paint (ms)',
    ).toEqual([]);
  });
});
