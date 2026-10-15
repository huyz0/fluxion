import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// The layout benchmark (FR-LAY-007, NFR-PERF-005, 05 §2): Arrange the 500 elements of the perf-500 example with `layered`; the layout runs in the
// studio's worker, so the page's main thread must stay free: no long task (the browser reports one past 50 ms) while the job is started and runs. Writing the 500 new boxes into the document (one
// transaction, so one undo step) and drawing them is a task of its own; its length is reported with the test, not bounded (backlog M13.31). It runs in its own project (`perf`, chromium) with one worker, nothing beside it (@perf).

/** What the main thread did while `during` ran: its tasks past 50 ms (the browser reports no others), split at the mark set just before the boxes are written. */
async function tasksDuring(page: Page, during: () => Promise<void>): Promise<{ layout: number[]; write: number[] }> {
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: { start: number; end: number }[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push({ start: e.startTime, end: e.startTime + e.duration });
    }).observe({ type: 'longtask' });
  });
  await during();
  // the observer reports on the next turn of the event loop
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const tasks = (window as unknown as { longTasks: { start: number; end: number }[] }).longTasks;
    const mark = performance.getEntriesByName('fluxion:arrange-apply')[0]?.startTime ?? Number.POSITIVE_INFINITY;
    // a task that ends by the mark is the layout's (reading the document, starting the job); one that holds the mark or follows it is the write's
    const ms = (list: { start: number; end: number }[]) => list.map((t) => t.end - t.start);
    return { layout: ms(tasks.filter((t) => t.end <= mark + 1)), write: ms(tasks.filter((t) => t.end > mark + 1)) };
  });
}

test.describe('layout performance', { tag: '@perf' }, () => {
  test('FR-LAY-007: arranging 500 elements with layered leaves no main-thread task over 50 ms before the boxes are written', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('example-perf-500');
    await expect(editor.elements).toHaveCount(500);
    const first = editor.elements.first();
    const start = await first.boundingBox();
    if (start === null) throw new Error('the first element is not drawn');
    await page.keyboard.press('ControlOrMeta+a');
    const at = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    // the menu is open and its item found before the measure starts: finding it walks the whole page, which is the test's own work
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const item = page.getByRole('menuitem', { name: 'Arrange the selection (layered)' });
    await item.waitFor();
    const tasks = await tasksDuring(page, async () => {
      await item.click();
      // the boxes change when the worker has answered and the result is written
      await expect.poll(async () => JSON.stringify(await first.boundingBox()), { timeout: 30_000 }).not.toBe(JSON.stringify(start));
    });
    // the layout (the worker's) leaves the main thread free; writing 500 new boxes into the document and drawing them is its own task, reported, not bounded here
    test.info().annotations.push({ type: 'write task ms', description: tasks.write.map((ms) => ms.toFixed(0)).join(', ') || 'none' });
    expect(tasks.layout, `main-thread tasks over 50 ms before the boxes were written: ${tasks.layout.map((ms) => ms.toFixed(0)).join(', ')} ms`).toEqual([]);
  });
});
