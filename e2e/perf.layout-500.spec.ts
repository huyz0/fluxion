import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The layout benchmark (FR-LAY-007, NFR-PERF-005, 05 §2): Arrange the 500 elements of the perf-500 example with `layered`; the layout runs in the studio's
// worker and its 500 boxes are written in slices (one undo step), so the page's main thread stays free: no long task (the browser reports one past 50 ms)
// from the click to the last box. It runs in its own project (`perf`, chromium) with one worker, nothing beside it (@perf).

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

test.describe('layout performance', { tag: '@perf' }, () => {
  test('FR-LAY-007: arranging 500 elements with layered leaves no main-thread task over 50 ms', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-perf-500');
    await expect(editor.elements).toHaveCount(500);
    const first = editor.elements.first();
    const start = await first.boundingBox();
    if (start === null) throw new Error('the first element is not drawn');
    // right-click the empty corner of the screen: the screen's own menu, with nothing selected (a selection of 500 makes the inspector's mixed-value
    // fields a cost of their own, which this spec does not measure)
    const screen = await editor.screenBox();
    await page.mouse.click(screen.x + 2, screen.y + 2, { button: 'right' });
    const item = page.getByRole('menuitem', { name: 'Arrange the screen (layered)' });
    await item.waitFor();
    // the click and the wait run inside the page: Playwright's own click (its actionability checks) and its polling would be tasks of the page too
    const tasks = await longTasksDuring(page, () =>
      item.evaluate(
        (el) =>
          new Promise<void>((done) => {
            (el as HTMLElement).click();
            // the notice says "Arranging…" from the click until the last slice is written
            const timer = setInterval(() => {
              if (document.querySelector('.fx-chrome-notice') === null) {
                clearInterval(timer);
                done();
              }
            }, 50);
          }),
      ),
    );
    expect(JSON.stringify(await first.boundingBox()), 'the elements moved').not.toBe(JSON.stringify(start));
    expect(
      tasks.map((ms) => ms.toFixed(0)),
      'main-thread tasks over 50 ms (ms)',
    ).toEqual([]);
  });
});
