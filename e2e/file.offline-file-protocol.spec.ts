import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// NFR-SEC-002, NFR-PORT-002, FR-FIL-001: a `.flux.html` opened from `file://` with the network blocked draws its deck, makes no request of its own,
// and the CSP stops a fetch a script plants. The player and the archive are the built ones (ADR-0154), the file is written by the built writer.
test.describe('a .flux.html from file://', () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-file-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('two-rects-line', { title: 'Offline deck' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-FIL-001: the file opens with no network and draws its first screen, with 0 external requests', async ({ page, blocked }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(url);
    await expect(page.locator('.fx-screen').first()).toBeVisible();
    await expect(page.locator('#fluxion-root')).not.toHaveText(/cannot/);
    expect(await page.title()).toBe('Offline deck');
    expect(problems).toEqual([]);
    expect(blocked).toEqual([]);
    // nothing but the file itself and in-page blob/data URLs
    expect(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
  });

  test('NFR-SEC-002: the CSP stops a planted fetch, a planted script and a planted frame, and says so', async ({ page, blocked }) => {
    await page.goto(url);
    await expect(page.locator('.fx-screen').first()).toBeVisible();
    const outcome = await page.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      const fetched = await fetch('https://example.com/planted').then(
        () => 'sent',
        () => 'blocked',
      );
      const script = document.createElement('script');
      script.textContent = 'window.__planted = true';
      document.head.append(script);
      const frame = document.createElement('iframe');
      frame.src = 'https://example.com/frame';
      document.body.append(frame);
      await new Promise((r) => setTimeout(r, 300));
      return { fetched, planted: (window as unknown as { __planted?: boolean }).__planted === true, violations };
    });
    expect(outcome.fetched).toBe('blocked');
    expect(outcome.planted).toBe(false);
    expect(outcome.violations.some((d) => d.startsWith('connect-src'))).toBe(true);
    expect(outcome.violations.some((d) => d.startsWith('script-src'))).toBe(true);
    // the browser never sent it: the context's own block saw nothing either
    expect(blocked).toEqual([]);
  });
});
