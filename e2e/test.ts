import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect, type TestInfo } from '@playwright/test';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// a `file:` URL is the machine's own disk, not the network (the .flux.html specs open files), and a `blob:` or `data:` URL is the page's
// own memory (WebKit routes a Blob worker's script through the context: M16.28); everything remote stays blocked
const isLocal = (url: URL): boolean => ['file:', 'blob:', 'data:'].includes(url.protocol) || LOCAL.has(url.hostname);

// when each test started (M19.29), so a page object can stop waiting before the test's own timeout closes the page it would report on
const startedAt = new WeakMap<TestInfo, number>();
// what a wait leaves for reading the page and failing with what it read: one evaluate and an annotation, well under a second
const REPORT_MARGIN_MS = 2_000;

/**
 * The time a wait in `info`'s test may take and still leave the page open to report on (M19.29): the test's timeout less what has
 * passed and a margin, at least 1 s; undefined when the test has no timeout.
 */
export function timeLeft(info: TestInfo, now: number = Date.now()): number | undefined {
  if (info.timeout === 0) return undefined;
  return Math.max(1_000, info.timeout - (now - (startedAt.get(info) ?? now)) - REPORT_MARGIN_MS);
}

interface Fixtures {
  /** Notes when the test started, for `timeLeft`. */
  started: undefined;
  /** URLs the network block stopped in this test (requests and WebSockets, every page). */
  blocked: string[];
  /** axe on the page's current state: no serious or critical violation (testing.md §7, NFR-A11Y-001). */
  expectAccessible: () => Promise<void>;
}

// Every spec imports `test` from here. The network is blocked for the whole browser context (every
// page, popup and WebSocket; service workers are blocked in playwright.config.ts), so a test can never
// pass because of a live third-party service (testing.md §5).
export const test = base.extend<Fixtures>({
  started: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure their dependencies
    async ({}, use, testInfo) => {
      startedAt.set(testInfo, Date.now());
      await use(undefined);
    },
    { auto: true },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure their dependencies
  blocked: async ({}, use) => {
    await use([]);
  },
  context: async ({ context, blocked }, use) => {
    await context.route(
      (url) => !isLocal(url),
      (route) => {
        blocked.push(route.request().url());
        return route.abort('blockedbyclient');
      },
    );
    await context.routeWebSocket(
      (url) => !isLocal(url),
      (ws) => {
        blocked.push(ws.url());
        return ws.close();
      },
    );
    await use(context);
  },
  expectAccessible: async ({ page }, use) => {
    await use(async () => {
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      // each violation with the elements it names, so a failure on one engine says where to look
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`)).toEqual([]);
    });
  },
});
export { expect };
