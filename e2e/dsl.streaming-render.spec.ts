import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// FR-AI-010: a streamed FluxScript source feeds the open document screen by screen. The studio's test hook hands the spec a fake stream it
// holds open; `push` resolves once the studio has applied the chunk.
const HEAD = 'flux: 1\ntitle: Streamed\nuses: [basic]\nscreens:\n';
const ONE = '- id: one\n  title: One\n  nodes:\n    a: { shape: rect, label: Alpha }\n    b: { shape: rect, label: Beta }\n  edges:\n  - a -> b\n';
const TWO = '- id: two\n  title: Two\n  nodes:\n    c: { shape: rect, label: Gamma }\n';
const THREE = '- id: three\n  title: Three\n  nodes:\n    d: { shape: rect, label: Delta }\n    e: { shape: rect, label: Eps }\n  edges:\n  - d -> e\n';

type Handle = { push(chunk: string): Promise<void>; close(): Promise<{ status: string; screens: number }> };
declare global {
  interface Window {
    __stream?: Handle;
    __FLUXION_TEST_HOOKS__?: boolean;
  }
}

const push = (page: Page, chunk: string): Promise<void> => page.evaluate((c) => (window.__stream as Handle).push(c), chunk);

test.describe('streamed render', { tag: '@desktop' }, () => {
  test('FR-AI-010: screens appear in order while the stream is open, whole, and the end holds every screen', async ({ page }) => {
    await page.addInitScript(() => {
      window.__FLUXION_TEST_HOOKS__ = true;
    });
    const editor = new EditorPage(page);
    await editor.open('new');
    const rows = editor.panel('Screens, library and layers').locator('.fx-chrome-screen');
    const names = () =>
      rows.evaluateAll((all) => all.map((r) => r.querySelector('.fx-chrome-screen-button > span:not(.fx-chrome-screen-format)')?.textContent?.trim() ?? ''));
    await expect(rows).toHaveCount(1);
    await expect(editor.shapes).toHaveCount(0);
    await page.evaluate(() => {
      window.__stream = (window as unknown as { __fluxion: { streamFlux(): Handle } }).__fluxion.streamFlux();
    });

    // (1) the header, and the first block still open: nothing of the stream is in the document
    await push(page, HEAD + ONE.slice(0, 60));
    expect(await names()).toEqual(['Screen 1']);
    await expect(editor.shapes).toHaveCount(0);

    // (2) the first block completes when the second begins: screen One replaces the empty one, whole (two shapes and the edge)
    await push(page, ONE.slice(60) + TWO.slice(0, 20));
    await expect.poll(names).toEqual(['One']);
    await expect(editor.shapes).toHaveCount(2);
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(editor.canvas.getByText('Beta', { exact: true })).toBeVisible();

    // the second completes when the third begins; the canvas stays on the first screen, which arrived first
    await push(page, TWO.slice(20) + THREE.slice(0, 15));
    await expect.poll(names).toEqual(['One', 'Two']);
    await expect(editor.shapes).toHaveCount(2);
    await editor.screenTab('Two').click();
    await expect(editor.shapes).toHaveCount(1);
    await expect(editor.canvas.getByText('Gamma', { exact: true })).toBeVisible();

    // (3) the last block is still open, then the stream ends: it completes
    await push(page, THREE.slice(15));
    expect(await names()).toEqual(['One', 'Two']);
    const result = await page.evaluate(() => (window.__stream as Handle).close());
    expect(result).toMatchObject({ status: 'done', screens: 3 });
    await expect.poll(names).toEqual(['One', 'Two', 'Three']);
    await editor.screenTab('Three').click();
    await expect(editor.shapes).toHaveCount(2);
    await expect(editor.canvas.getByText('Delta', { exact: true })).toBeVisible();

    // the whole stream is one undo step: undo brings the empty screen back
    await editor.toolbarButton('Undo').click();
    await expect.poll(names).toEqual(['Screen 1']);
  });
});
