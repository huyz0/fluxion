import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { drag, onScreen, shapeAt } from './pages/connectors.js';
import { EditorPage } from './pages/editor.js';
import { pickers } from './pages/file-pickers.js';
import { fluxJsonOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

type Rec = { readonly id: string; readonly type: string; readonly kind?: string; readonly defId?: string; readonly elementId?: string };

/** The records of the document as Save writes it now. */
async function savedRecords(page: Page): Promise<Rec[]> {
  const download = page.waitForEvent('download');
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await download;
  const doc = JSON.parse(await fluxJsonOf(readFileSync((await saved.path()) as string))) as { records: Record<string, Rec> };
  return Object.values(doc.records);
}

// clicks, a drag and the library panel: desktop input; the same spec runs on all three engines
test.describe('replace shape from the library', { tag: '@desktop' }, () => {
  test('FR-LIB-011: WHEN a user replaces the selected shape from the library THE SYSTEM SHALL keep its connectors and text', async ({ page }) => {
    const editor = new EditorPage(page);
    await pickers(page, undefined);
    await editor.open('new');
    await shapeAt(page, editor, 0.1, 1);
    await shapeAt(page, editor, 0.6, 2);
    await editor.toolButton('Connector').click();
    await drag(page, await onScreen(editor, 0.16, 0.4), await onScreen(editor, 0.66, 0.4));
    const connectors = editor.canvas.locator('.fx-el[data-kind="connector"]');
    await expect(connectors).toHaveCount(1);
    // the left shape, labelled: selected by a click, then its text typed in
    await page.keyboard.press('Escape');
    const left = await onScreen(editor, 0.13, 0.33);
    await page.mouse.click(left.x, left.y);
    await page.keyboard.press('Enter');
    await expect(editor.canvas.getByRole('textbox')).toBeVisible();
    await page.keyboard.type('Web server');
    await page.keyboard.press('Escape');
    await expect(editor.shapes.first().locator('.fx-label')).toHaveText('Web server');

    const panel = editor.panel('Screens, library and layers');
    await panel.getByRole('tab', { name: 'Library', exact: true }).click();
    const toggle = panel.getByRole('button', { name: 'Replace selected shape' });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await panel.locator('[data-def-id="basic:ellipse"] button').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // still two shapes and one connector, the label kept
    await expect(editor.shapes).toHaveCount(2);
    await expect(connectors).toHaveCount(1);
    await expect(editor.shapes.first().locator('.fx-label')).toHaveText('Web server');

    const records = await savedRecords(page);
    const shapes = records.filter((r) => r.type === 'element' && r.kind === 'shape');
    const ellipse = shapes.find((r) => r.defId === 'basic:ellipse');
    expect(ellipse).toBeDefined();
    expect(shapes.map((r) => r.defId).sort()).toEqual(['basic:ellipse', 'basic:rect']);
    // both connector ends stay bound: one to the replaced shape, one to the other
    const bound = records.filter((r) => r.type === 'binding').map((r) => r.elementId);
    expect(bound).toHaveLength(2);
    expect(bound).toContain(ellipse?.id);

    // one undo brings the rect back, still labelled and bound
    await editor.canvas.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await savedRecords(page);
    expect(undone.filter((r) => r.type === 'element' && r.kind === 'shape').map((r) => r.defId)).toEqual(['basic:rect', 'basic:rect']);
    expect(undone.filter((r) => r.type === 'binding').map((r) => r.elementId)).toContain(ellipse?.id);
    await expect(editor.shapes.first().locator('.fx-label')).toHaveText('Web server');
  });
});
