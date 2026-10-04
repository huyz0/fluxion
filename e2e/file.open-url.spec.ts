import { EditorPage } from './pages/editor.js';
import { fluxFileOf, titleOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

// the other ways a file reaches the studio (FR-FIL-006): a ?src= URL and a pasted file; desktop input
test.describe('opening from a URL and the clipboard', { tag: '@desktop' }, () => {
  test('FR-FIL-006: ?src= fetches a .flux and opens it in the editor under the file’s name', async ({ page }) => {
    const bytes = await fluxFileOf('minimal');
    await page.route(
      (url) => url.pathname === '/shared/deck.flux',
      (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(bytes) }),
    );
    await page.goto('/?src=/shared/deck.flux');
    await expect(page).toHaveURL(/\/edit\/file-\d+$/);
    await new EditorPage(page).screens.first().waitFor();
    expect(await titleOf(bytes)).toBe('Minimal');
  });

  test('FR-FIL-006: a ?src= that cannot be fetched says so and leaves the home page', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/shared/missing.flux',
      (route) => route.fulfill({ status: 404, body: 'no' }),
    );
    await page.goto('/?src=/shared/missing.flux');
    await expect(page.getByRole('alert')).toContainText('missing.flux could not be fetched: the server answered 404');
    await expect(page.getByTestId('studio-root')).toBeVisible();
  });

  test('FR-FIL-006: a ?src= with a script URL is ignored', async ({ page }) => {
    await page.goto('/?src=javascript:alert(1)');
    await expect(page.getByRole('heading', { name: 'Fluxion Studio' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('FR-FIL-006: a .flux pasted on the home page opens', async ({ page }) => {
    const bytes = await fluxFileOf('minimal');
    await page.goto('/');
    await page.getByRole('heading', { name: 'Fluxion Studio' }).waitFor();
    await page.evaluate((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], 'pasted.flux'));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, Array.from(bytes));
    await expect(page).toHaveURL(/\/edit\/file-\d+$/);
    await new EditorPage(page).screens.first().waitFor();
  });

  test('FR-FIL-006: the web manifest is installable (192 and 512 pixel icons) and hands .flux and .flux.html files to the app', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest');
    const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as {
      icons: { src: string; sizes: string }[];
      file_handlers: { action: string; accept: Record<string, string[]> }[];
    };
    expect(manifest.icons.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      const res = await page.request.get(icon.src);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    expect(manifest.file_handlers[0]?.action).toBe('/');
    expect(
      Object.values(manifest.file_handlers[0]?.accept ?? {})
        .flat()
        .sort(),
    ).toEqual(['.flux', '.flux.html']);
  });
});
