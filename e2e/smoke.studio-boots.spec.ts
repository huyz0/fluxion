import { StudioPage } from './pages/studio.js';
import { expect, test } from './test.js';

test('smoke: the studio boots and renders an accessible shell', async ({ page, expectAccessible }) => {
  const studio = new StudioPage(page);
  await studio.open();
  await expect(studio.root).toBeVisible();
  await expect(studio.heading).toHaveText('Fluxion Studio');
  await expectAccessible();
});

test('smoke: requests and WebSockets that leave localhost are blocked, on every page @no-a11y (no UI under test)', async ({ page, context, blocked }) => {
  const studio = new StudioPage(page);
  await studio.open();
  // no-cors: an opaque response resolves whenever the network is reachable, so only a block rejects
  const probe = () =>
    Promise.all([
      fetch('https://example.com/', { mode: 'no-cors' }).then(
        () => 'reached',
        () => 'blocked',
      ),
      new Promise<string>((resolve) => {
        const ws = new WebSocket('wss://example.com/');
        ws.onopen = () => resolve('open');
        ws.onclose = () => resolve('closed');
      }),
    ]);
  expect(await page.evaluate(probe)).toEqual(['blocked', 'closed']);
  const popup = await context.newPage();
  await popup.goto(page.url());
  expect(await popup.evaluate(probe)).toEqual(['blocked', 'closed']);
  // the block itself stopped them (a closed socket alone proves nothing: the host has no WS server)
  expect(blocked.filter((u) => u === 'https://example.com/')).toHaveLength(2);
  expect(blocked.filter((u) => u === 'wss://example.com/')).toHaveLength(2);
});
