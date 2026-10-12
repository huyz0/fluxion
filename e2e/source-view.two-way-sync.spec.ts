import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// FR-EDT-022: the Source tab shows the open screen's FluxScript. An edit of the text reaches the canvas after the pause (300 ms), a typo shows
// a gutter diagnostic and leaves the canvas as it was, and each apply is one undo step. A canvas edit regenerates the text of a clean view and raises the
// reload banner on a dirty one; blur applies the typed text at once (M12.48). The merge is M12.49.
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

/** Open a new document holding the two-screen source, with the Source tab shown on the first. */
async function openSource(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __FLUXION_TEST_HOOKS__: boolean; __holdApply?: boolean };
    w.__FLUXION_TEST_HOOKS__ = true;
    // a test can stop the 300 ms pause of the source view from ever ending: only a blur can apply the text then
    const set = window.setTimeout.bind(window);
    window.setTimeout = ((run: TimerHandler, ms?: number, ...rest: unknown[]) =>
      w.__holdApply === true && ms === 300 ? 0 : set(run, ms, ...rest)) as typeof window.setTimeout;
  });
  const editor = new EditorPage(page);
  await editor.open('new');
  await page.evaluate(async (source) => {
    const stream = (window as unknown as { __fluxion: { streamFlux(): Stream } }).__fluxion.streamFlux();
    await stream.push(source);
    await stream.close();
  }, SOURCE);
  await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
  const left = editor.panel('Screens, library and layers');
  await left.getByRole('tab', { name: 'Source' }).click();
  const text = left.getByRole('textbox', { name: 'FluxScript source' });
  await expect(text).toContainText('label: Alpha');
  return { editor, left, text };
}

/** Where a shape that shows `label` is drawn, in the screen's own units (the fitted screen is `DEFAULT_SCREEN_SIZE` wide: 1920). */
async function placeOf(editor: EditorPage, label: string): Promise<{ x: number; y: number; w: number; h: number; scale: number }> {
  const [shape, screen] = [await editor.shapes.filter({ hasText: label }).boundingBox(), await editor.screenBox()];
  if (shape === null) throw new Error(`no shape shows "${label}"`);
  const scale = screen.width / 1920;
  return { x: (shape.x - screen.x) / scale, y: (shape.y - screen.y) / scale, w: shape.width / scale, h: shape.height / scale, scale };
}

/**
 * A canvas edit by a real drag: the shape that shows `label` is pressed at its centre and moved by (`dx`, `dy`) screen units with snapping off, so the
 * pointer's own distance is the move. Returns where the shape was drawn before and the distance it was dragged.
 */
async function dragShape(editor: EditorPage, label: string, dx: number, dy: number) {
  const { page } = editor;
  const before = await placeOf(editor, label);
  const from = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
  const screen = await editor.screenBox();
  const at = (p: { x: number; y: number }) => ({ x: screen.x + p.x * before.scale, y: screen.y + p.y * before.scale });
  await page.mouse.move(at(from).x, at(from).y);
  await page.mouse.down();
  await page.mouse.move(at({ x: from.x + dx, y: from.y + dy }).x, at({ x: from.x + dx, y: from.y + dy }).y, { steps: 8 });
  await page.mouse.up();
  return { before, dx, dy };
}

/** The `x` and `y` of the `pin:` written on the line of `text` that shows `label`. */
async function pinOf(text: Locator, label: string): Promise<{ x: number; y: number }> {
  const line = await text.locator('.cm-line', { hasText: `label: ${label}` }).innerText();
  const m = /pin: \{ x: (-?[\d.]+), y: (-?[\d.]+)/.exec(line);
  if (m === null) throw new Error(`no pin on the line of "${label}": ${line}`);
  return { x: Number(m[1]), y: Number(m[2]) };
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

  test('FR-EDT-022: a shape dragged on the canvas writes its pin, in one regenerated text, and undo takes the pin away', async ({ page }) => {
    const { editor, text } = await openSource(page);
    await expect(text).not.toContainText('pin:');
    // the drag is the pointer's exactly: snapping is off
    await editor.toolbarButton('Snapping').click();
    // every text the view shows while the drag runs: the regeneration waits for the drag to settle (50 ms look, M12.48)
    await page.evaluate(() => {
      const w = window as unknown as { __texts: string[] };
      w.__texts = [];
      const line = () => document.querySelector('[aria-label="FluxScript source"]')?.textContent ?? '';
      new MutationObserver(() => {
        const now = line();
        if (w.__texts.at(-1) !== now) w.__texts.push(now);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const { before, dx, dy } = await dragShape(editor, 'Alpha', 120, 80);
    const alpha = text.locator('.cm-line', { hasText: 'label: Alpha' });
    await expect(alpha).toContainText('pin: { x: ');
    const pin = await pinOf(text, 'Alpha');
    // the pin is where the shape was put (a pixel of the stroke aside)
    expect(Math.abs(pin.x - (before.x + dx))).toBeLessThan(4);
    expect(Math.abs(pin.y - (before.y + dy))).toBeLessThan(4);
    await expect(text.locator('.cm-line', { hasText: 'label: Beta' })).not.toContainText('pin:');
    // one text with the pin came out of the whole drag, however many frames it ran
    const texts = await page.evaluate(() => (window as unknown as { __texts: string[] }).__texts);
    expect(texts.filter((t) => t.includes('pin:'))).toHaveLength(1);
    // the drag was one undo step: the pin goes, the text is the generated one again
    await editor.toolbarButton('Undo').click();
    await expect(text).not.toContainText('pin:');
    await expect(text).toContainText('label: Alpha');
  });

  test('FR-EDT-022: a canvas change under a dirty view is not written over it: the banner shows, and Reload takes the canvas', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    // a typo: the text does not compile, so it stays unapplied and the view stays dirty
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'rect');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('t');
    await expect(left.locator('.fx-source-marker[data-severity="error"]')).toHaveCount(1);
    await editor.toolbarButton('Snapping').click();
    await dragShape(editor, 'Beta', 120, 80);
    const banner = left.getByText('Canvas changed — reload');
    await expect(banner).toBeVisible();
    await expect(text).toContainText('shape: rectt');
    await expect(text).not.toContainText('pin:');
    // only the author's click replaces the text
    await left.getByRole('button', { name: 'Reload' }).click();
    await expect(text.locator('.cm-line', { hasText: 'label: Beta' })).toContainText('pin: { x: ');
    await expect(text).not.toContainText('rectt');
    await expect(banner).toHaveCount(0);
    await expect(left.locator('.fx-source-marker[data-severity="error"]')).toHaveCount(0);
  });

  test('FR-EDT-022: text typed just before the editor is blurred is applied at once', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    await page.evaluate(() => {
      (window as unknown as { __holdApply: boolean }).__holdApply = true;
    });
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'Alpha');
    await page.keyboard.type('Omega');
    // the pause never ends here: nothing has reached the canvas
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
    // leaving the editor for the tab (Escape would close the completion list first)
    await left.getByRole('tab', { name: 'Source' }).focus();
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toHaveCount(0);
  });
});
