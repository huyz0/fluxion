import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocal = (url: URL): boolean => LOCAL.has(url.hostname);

interface Fixtures {
  /** URLs the network block stopped in this test (requests and WebSockets, every page). */
  blocked: string[];
  /** axe on the page's current state: no serious or critical violation (testing.md §7, NFR-A11Y-001). */
  expectAccessible: () => Promise<void>;
}

// Every spec imports `test` from here. The network is blocked for the whole browser context (every
// page, popup and WebSocket; service workers are blocked in playwright.config.ts), so a test can never
// pass because of a live third-party service (testing.md §5).
export const test = base.extend<Fixtures>({
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
      expect(serious.map((v) => v.id)).toEqual([]);
    });
  },
});
export { expect };
