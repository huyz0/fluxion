import type { Locator } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// FR-EDT-022: the Source tab shows the open screen's FluxScript. An edit of the text reaches the canvas after the pause (300 ms), a typo shows
// a gutter diagnostic and leaves the canvas as it was, and each apply is one undo step. (Canvas to text is M12.48, the merge M12.49.)
const SOURCE =
  'flux: 1\ntitle: Synced\nuses: [basic]\nscreens:\n' +
  '- id: one\n  title: One\n  nodes:\n    a: { shape: rect, label: Alpha }\n    b: { shape: rect, label: Beta }\n  edges:\n  - a -> b\n' +
  '- id: two\n  title: Two\n  nodes:\n    c: { shape: rect, label: Gamma }\n';

type Stream = { push(chunk: string): Promise<void>; close(): Promise<{ status: string; screens: number }> };

/** Select the first occurrence of `word` in the line the way a person's drag would: through the DOM selection, which CodeMirror reads. */
async function select(line: Locator, word: string): Promise<void> {
  await line.click();
  await line.evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent?.indexOf(w) ?? -1;
      if (at >= 0) return getSelection()?.setBaseAndExtent(n, at, n, at + w.length);
    }
  }, word);
}

test.describe('source view', { tag: '@desktop' }, () => {
  test('FR-EDT-022: an edited label changes the shape, a typo shows a gutter diagnostic and leaves the canvas, each apply is one undo step', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    const editor = new EditorPage(page);
    await editor.open('new');
    // the document the source view will show: two screens, the canvas on the first
    await page.evaluate(async (source) => {
      const stream = (window as unknown as { __fluxion: { streamFlux(): Stream } }).__fluxion.streamFlux();
      await stream.push(source);
      await stream.close();
    }, SOURCE);
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();

    const left = editor.panel('Screens, library and layers');
    const tab = left.getByRole('tab', { name: 'Source' });
    await tab.click();
    const text = left.getByRole('textbox', { name: 'FluxScript source' });
    await expect(text).toBeVisible();
    await expect(text).toContainText('label: Alpha');
    await expect(text).not.toContainText('Gamma');

    // (1) an edited label changes the shape on the canvas
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'Alpha');
    await page.keyboard.type('Omega');
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toHaveCount(0);
    await expect(editor.canvas.getByText('Beta', { exact: true })).toBeVisible();
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();

    // (2) a typo: a gutter marker with the message, a row in the list, the canvas as it was
    await select(text.locator('.cm-line', { hasText: 'label: Omega' }), 'rect');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('t');
    const marker = left.locator('.fx-source-marker[data-severity="error"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute('title', /rectt/);
    await expect(left.getByRole('list', { name: 'Source problems' }).getByRole('listitem')).toHaveCount(1);
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(editor.canvas.getByText('Beta', { exact: true })).toBeVisible();
    await expect(editor.shapes).toHaveCount(2);

    // (3) the apply was one undo step: undo once, and the label before the edit is back
    await editor.toolbarButton('Undo').click();
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(editor.canvas.getByText('Omega', { exact: true })).toHaveCount(0);

    // Escape in the editor puts the focus back on the tab
    await text.click();
    await page.keyboard.press('Escape');
    await expect(tab).toBeFocused();
  });
});
