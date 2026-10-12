import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// FR-EDT-022: the Source tab shows the open screen's FluxScript. An edit of the text reaches the canvas after the pause (300 ms), a typo shows
// a gutter diagnostic and leaves the canvas as it was, and each apply is one undo step. A canvas edit regenerates the text of a clean view and raises the
// reload banner on a dirty one; blur applies the typed text at once (M12.48). An apply is a three-way merge (M12.49): what the canvas changed and the
// text did not stays, a renamed slug keeps its record, and a record that points at a deleted element is cleaned.
const SOURCE =
  'flux: 1\ntitle: Synced\nuses: [basic]\nscreens:\n' +
  '- id: one\n  title: One\n  nodes:\n    a: { shape: rect, label: Alpha }\n    b: { shape: rect, label: Beta }\n  edges:\n  - a -> b\n' +
  '- id: two\n  title: Two\n  nodes:\n    c: { shape: rect, label: Gamma }\n';

type Stream = { push(chunk: string): Promise<void>; close(): Promise<{ status: string; screens: number }> };
type Records = { readonly [id: string]: { readonly [field: string]: unknown } };
type Hooks = { records(): Records; applyRecords(puts: readonly object[], deletes?: readonly string[]): string | undefined };

/** The same screen with a third node on its own (no edge), for the cases that delete one. */
const SOURCE_SOLO = SOURCE.replace('b: { shape: rect, label: Beta }\n', 'b: { shape: rect, label: Beta }\n    d: { shape: rect, label: Delta }\n');

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
async function openSource(page: Page, source = SOURCE) {
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
  }, source);
  await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
  const left = editor.panel('Screens, library and layers');
  await left.getByRole('tab', { name: 'Source' }).click();
  const text = left.getByRole('textbox', { name: 'FluxScript source' });
  await expect(text).toContainText('label: Alpha');
  return { editor, left, text };
}

/** Every record of the open document (the test hook). */
const recordsOf = (page: Page): Promise<Records> => page.evaluate(() => (window as unknown as { __fluxion: Hooks }).__fluxion.records());

/** Write records beside the source's, through the test hook. */
async function addRecords(page: Page, puts: readonly object[]): Promise<void> {
  const problem = await page.evaluate((list) => (window as unknown as { __fluxion: Hooks }).__fluxion.applyRecords(list), puts);
  expect(problem).toBeUndefined();
}

/** The record id of the element whose slug is `slug`, and the id of the screen whose source id is `screen`. */
const idOfSlug = (records: Records, slug: string): string | undefined =>
  Object.keys(records).find((id) => (records[id]?.['semantic'] as { slug?: string } | undefined)?.slug === slug);
const screenOf = (records: Records, slug: string): string => {
  const id = Object.keys(records).find((i) => records[i]?.['type'] === 'screen' && (records[i]?.['meta'] as { slug?: string } | undefined)?.slug === slug);
  if (id === undefined) throw new Error(`no screen ${slug}`);
  return id;
};

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
    // the pointer's float noise is not written (M12.57): every number of the pin has at most 2 decimals
    const written = (await alpha.innerText()).replace(/^.*pin: \{/, '').replace(/\}.*$/, '');
    const numbers = written.match(/-?\d[\d.e+-]*/g) ?? [];
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    for (const n of numbers) expect(n).toMatch(/^-?\d+(\.\d{1,2})?$/);
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

  test('FR-EDT-022: an element outside the subset survives an apply, with the comment on it', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    const screen = screenOf(await recordsOf(page), 'one');
    await addRecords(page, [
      { id: 'kept-frame', type: 'element', kind: 'frame', screenId: screen, index: 'a8', transform: { x: 900, y: 600, w: 200, h: 120 } },
      { id: 'kept-note', type: 'comment', targetId: 'kept-frame', author: 'ada', body: 'keep me' },
    ]);
    // the view is clean: it shows the frame as left out
    await expect(text).toContainText('kept: 1 records not shown');
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'Alpha');
    await page.keyboard.type('Omega');
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();
    const records = await recordsOf(page);
    expect(records['kept-frame']).toMatchObject({ kind: 'frame', transform: { x: 900, y: 600, w: 200, h: 120 } });
    expect(records['kept-note']).toMatchObject({ targetId: 'kept-frame' });
    await expect(text).toContainText('kept: 1 records not shown');
  });

  test('FR-EDT-022: a shape dragged while the view holds unapplied text keeps its new pin after that text is applied (e2e, a real drag)', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    await page.evaluate(() => {
      (window as unknown as { __holdApply: boolean }).__holdApply = true;
    });
    // a typo: the text does not compile, so it is unapplied while the canvas changes
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'rect');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('t');
    await editor.toolbarButton('Snapping').click();
    await dragShape(editor, 'Beta', 120, 80);
    await expect(left.getByText('Canvas changed — reload')).toBeVisible();
    const dragged = await placeOf(editor, 'Beta');
    // the author fixes the typo and edits a label, then leaves the view: both are applied at once
    await select(text.locator('.cm-line', { hasText: 'shape: rectt' }), 'rectt');
    await page.keyboard.type('rect');
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'Alpha');
    await page.keyboard.type('Omega');
    await left.getByRole('tab', { name: 'Source' }).focus();
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();
    // Beta is where the canvas put it: the pin is in the document, and the regenerated text says it
    const after = await placeOf(editor, 'Beta');
    expect(Math.abs(after.x - dragged.x)).toBeLessThan(1);
    expect(Math.abs(after.y - dragged.y)).toBeLessThan(1);
    const beta = Object.values(await recordsOf(page)).find((r) => (r['semantic'] as { slug?: string } | undefined)?.slug === 'b');
    expect(beta).toMatchObject({ placement: 'pinned' });
    await expect(text.locator('.cm-line', { hasText: 'label: Beta' })).toContainText('pin: { x: ');
    await expect(left.getByText('Canvas changed — reload')).toHaveCount(0);
  });

  test('FR-EDT-022: a slug renamed in place keeps its record under a new id, and what pointed at it follows', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    let records = await recordsOf(page);
    const before = idOfSlug(records, 'b');
    expect(before).toBeDefined();
    // a layer name and a comment: neither is in the text, so a delete and an add would lose them
    await addRecords(page, [
      { ...records[before as string], name: 'Backend layer' },
      { id: 'note-b', type: 'comment', targetId: before, author: 'ada', body: 'on b' },
    ]);
    await select(text.locator('.cm-line', { hasText: 'label: Beta' }), 'b');
    await page.keyboard.type('bee');
    await expect(left.locator('.fx-source-marker[data-severity="error"]')).toHaveCount(1);
    await select(text.locator('.cm-line', { hasText: '- a -> b' }), 'b');
    await page.keyboard.type('bee');
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();
    await expect(editor.canvas.getByText('Beta', { exact: true })).toBeVisible();
    records = await recordsOf(page);
    const now = idOfSlug(records, 'bee');
    expect(now).toBeDefined();
    expect(now).not.toBe(before);
    expect(records[before as string]).toBeUndefined();
    expect(records[now as string]).toMatchObject({ name: 'Backend layer', semantic: { slug: 'bee', label: 'Beta' } });
    expect(records['note-b']).toMatchObject({ targetId: now });
    const ends = Object.values(records).filter((r) => r['type'] === 'binding' && r['end'] === 'target');
    expect(ends.map((b) => b['elementId'])).toEqual([now]);
    // one undo step takes the rename back
    await editor.toolbarButton('Undo').click();
    expect((await recordsOf(page))[before as string]).toMatchObject({ name: 'Backend layer' });
    expect((await recordsOf(page))['note-b']).toMatchObject({ targetId: before });
  });

  test('FR-EDT-022: records that pointed at an element the text deleted are removed or cleaned, never left dangling, and undo brings them back', async ({
    page,
  }) => {
    const { editor, left, text } = await openSource(page, SOURCE_SOLO);
    const records = await recordsOf(page);
    const delta = idOfSlug(records, 'd') as string;
    const alpha = idOfSlug(records, 'a') as string;
    await addRecords(page, [
      { id: 'note-d', type: 'comment', targetId: delta, author: 'ada', body: 'on d' },
      { id: 'click-d', type: 'interaction', ownerId: delta, trigger: { kind: 'onClick' }, actions: [] },
      { id: 'tl', type: 'timeline', screenId: screenOf(records, 'one'), name: 'main', index: 'a0' },
      {
        id: 'step',
        type: 'step',
        timelineId: 'tl',
        index: 'a0',
        trigger: { kind: 'onClick' },
        animations: [{ id: 'x', effect: 'appear', targets: [delta, alpha] }],
      },
    ]);
    await expect(editor.canvas.getByText('Delta', { exact: true })).toBeVisible();
    // three clicks select the line; deleting it removes the node
    await text.locator('.cm-line', { hasText: 'label: Delta' }).click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await expect(editor.canvas.getByText('Delta', { exact: true })).toHaveCount(0);
    await expect(left.getByRole('status').filter({ hasText: 'Removed or cleaned 3 records' })).toBeVisible();
    const after = await recordsOf(page);
    expect(after['note-d']).toBeUndefined();
    expect(after['click-d']).toBeUndefined();
    expect(after['step']).toMatchObject({ animations: [{ id: 'x', effect: 'appear', targets: [alpha] }] });
    expect(JSON.stringify(after)).not.toContain(delta);
    await editor.toolbarButton('Undo').click();
    await expect(editor.canvas.getByText('Delta', { exact: true })).toBeVisible();
    const restored = await recordsOf(page);
    expect(restored['note-d']).toMatchObject({ targetId: delta });
    expect(restored['click-d']).toBeDefined();
  });

  test('FR-EDT-022: Mod-z in the editor undoes the typing in the text, not the document; the restored text is applied as one more step, and Mod-Shift-z redoes it', async ({
    page,
  }) => {
    const { editor, left, text } = await openSource(page);
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'Alpha');
    await page.keyboard.type('Omega');
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(left.getByRole('status').filter({ hasText: 'Applied' })).toBeVisible();
    // the pause is held: only a blur applies now, so what Mod-z does to the canvas on its own can be told
    await page.evaluate((on) => {
      (window as unknown as { __holdApply: boolean }).__holdApply = on;
    }, true);
    await page.keyboard.press('Control+z');
    await expect(text).toContainText('label: Alpha');
    await expect(text).not.toContainText('Omega');
    // the text was undone, the document was not (and was not undone by the window's shortcut too): the canvas still shows the applied label
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect(text).toContainText('label: Omega');
    await page.keyboard.press('Control+z');
    await expect(text).toContainText('label: Alpha');
    // the restored text is the author's edit: leaving the editor applies it, as one more document step
    await page.evaluate((on) => {
      (window as unknown as { __holdApply: boolean }).__holdApply = on;
    }, false);
    await page.keyboard.press('Escape');
    await expect(editor.canvas.getByText('Alpha', { exact: true })).toBeVisible();
    await expect(editor.canvas.getByText('Omega', { exact: true })).toHaveCount(0);
    // the toolbar's Undo is the document's own and independent of the text: it takes that apply back
    await editor.toolbarButton('Undo').click();
    await expect(editor.canvas.getByText('Omega', { exact: true })).toBeVisible();
    await expect(text).toContainText('label: Omega');
  });

  test('FR-EDT-022: a Reload is undone inside the view with Mod-z, and the restored text goes through the usual apply', async ({ page }) => {
    const { editor, left, text } = await openSource(page);
    await select(text.locator('.cm-line', { hasText: 'label: Alpha' }), 'rect');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('t');
    await expect(left.locator('.fx-source-marker[data-severity="error"]')).toHaveCount(1);
    await editor.toolbarButton('Snapping').click();
    await dragShape(editor, 'Beta', 120, 80);
    await left.getByRole('button', { name: 'Reload' }).click();
    await expect(text).toContainText('pin: { x: ');
    await expect(text).not.toContainText('shape: rectt');
    await page.keyboard.press('Control+z');
    await expect(text).toContainText('shape: rectt');
    await expect(text).not.toContainText('pin:');
  });

  test('FR-EDT-022: after a canvas drag regenerated the text, Mod-z in the editor leaves the drag and the text as they are (M12.60)', async ({ page }) => {
    const { editor, text } = await openSource(page);
    await editor.toolbarButton('Snapping').click();
    await dragShape(editor, 'Alpha', 120, 80);
    const alpha = text.locator('.cm-line', { hasText: 'label: Alpha' });
    await expect(alpha).toContainText('pin: { x: ');
    const pinned = await pinOf(text, 'Alpha');
    await alpha.click();
    await page.keyboard.press('Control+z');
    // the pause would have applied a restored pre-drag text by now
    await page.waitForTimeout(600);
    await expect(alpha).toContainText('pin: { x: ');
    expect(await pinOf(text, 'Alpha')).toEqual(pinned);
    await text.press('Escape');
    expect(await pinOf(text, 'Alpha')).toEqual(pinned);
  });
});
