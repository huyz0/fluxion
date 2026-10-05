import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-PERF-003: a 50-screen document opened from its `.flux.html` shows the first screen within OPEN_50_SCREENS_MS_DESKTOP, and on the reference mobile (a phone viewport,
// the CPU slowed 4 times) within OPEN_50_SCREENS_MS_MOBILE. The `.flux.html` form is measured because it is what a user pays for: the file is read, its base64 and archive
// are decoded and the first screen drawn. It runs in the `perf` project (chromium, one worker, nothing beside it): the time is a wall clock.

/** A bound from thresholds.mjs (read as text: the spec does not import the gate's module). */
function threshold(name: string): number {
  const text = readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8');
  return Number(new RegExp(`${name}: \\{ value: ([\\d_]+)`).exec(text)?.[1]?.replaceAll('_', ''));
}
const DESKTOP_MS = threshold('OPEN_50_SCREENS_MS_DESKTOP');
const MOBILE_MS = threshold('OPEN_50_SCREENS_MS_MOBILE');

test.describe('opening 50 screens', { tag: '@perf' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-open50-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc50', { title: 'Fifty screens' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Milliseconds from the start of navigation to the first screen drawn, the best of three opens (the first pays for a cold page). */
  async function firstScreenMs(page: Page): Promise<number> {
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const start = Date.now();
      await page.goto(url);
      await page.locator('.fx-screen').first().waitFor();
      times.push(Date.now() - start);
    }
    return Math.min(...times);
  }

  test('NFR-PERF-003: the first screen of 50 shows within OPEN_50_SCREENS_MS_DESKTOP on the desktop', async ({ page }) => {
    const ms = await firstScreenMs(page);
    await expect(page.getByTestId('deck-counter')).toHaveText('1 / 50');
    expect(ms, `first screen after ${ms} ms`).toBeLessThanOrEqual(DESKTOP_MS);
  });

  test('NFR-PERF-003: the first screen of 50 shows within OPEN_50_SCREENS_MS_MOBILE on a phone at 4 times CPU throttle', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const ms = await firstScreenMs(page);
      await expect(page.getByTestId('deck-counter')).toHaveText('1 / 50');
      expect(ms, `first screen after ${ms} ms at 4x`).toBeLessThanOrEqual(MOBILE_MS);
    } finally {
      await context.close();
    }
  });
});
