import { expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from './svg-witness-driver.js';
import { prepareWitnessPage } from './svg-witness-page.js';

it('NFR-SEC-001: routing containment is installed before page creation and inputs never enter markup', async () => {
  const order: string[] = [];
  const page = {
    setContent: vi.fn(async () => {
      order.push('content');
    }),
    evaluate: vi.fn(async () => true),
  } as unknown as Page;
  const abort = vi.fn(async () => {});
  const context = {
    route: vi.fn(async (_pattern: string, handler: (route: { abort: () => Promise<void> }) => Promise<void>) => {
      order.push('route');
      await handler({ abort });
    }),
    newPage: vi.fn(async () => {
      order.push('page');
      return page;
    }),
    close: vi.fn(async () => {}),
  } as unknown as BrowserContext;
  const browser = { newContext: vi.fn(async () => context) } as unknown as Browser;
  const input = { theme: { name: '</script><img src=https://evil.invalid>' }, fonts: [], encodedBytes: 100 };
  const result = await prepareWitnessPage(browser, input, 'trusted bundle', { alive: () => true });
  expect(result).toEqual({ page, accepted: true });
  expect(order).toEqual(['route', 'page', 'content']);
  expect(abort).toHaveBeenCalledTimes(1);
  const markup = vi.mocked(page.setContent).mock.calls[0]?.[0];
  expect(markup).toContain("default-src 'none'");
  expect(markup).not.toContain('evil.invalid');
  expect(vi.mocked(page.evaluate).mock.calls[1]?.[1]).toEqual(input);
});
it('NFR-SEC-001: cancellation after context creation prevents late page allocation and closes the context', async () => {
  let alive = true;
  const context = { close: vi.fn(async () => {}), newPage: vi.fn() } as unknown as BrowserContext;
  const browser = {
    newContext: vi.fn(async () => {
      alive = false;
      return context;
    }),
  } as unknown as Browser;
  await expect(prepareWitnessPage(browser, { theme: {}, fonts: [], encodedBytes: 0 }, '', { alive: () => alive })).rejects.toThrow('cancelled');
  expect(context.newPage).not.toHaveBeenCalled();
  expect(context.close).toHaveBeenCalledTimes(1);
});
