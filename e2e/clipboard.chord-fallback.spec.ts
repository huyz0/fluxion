import { dragOut } from './pages/create.js';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// FR-EDT-007, NFR-PORT-001 (M11.59): an engine that raises no copy or paste event for Ctrl/Cmd+C and V on the canvas (WebKit 26.5 does not; scripts/ci/clipboard-events-probe.mjs)
// still copies and pastes. A key event made by a script has no default action, so it raises no clipboard event on any engine: it is that engine's situation, anywhere.
test.describe('clipboard chords the browser raises no event for', { tag: '@desktop' }, () => {
  test('FR-EDT-007: Ctrl+C then Ctrl+V with no clipboard event copies and pastes, once each', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    const chord = (key: string) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true })), key);
    await chord('c');
    await chord('v');
    await expect(editor.elements).toHaveCount(2);
    // a second paste continues from the same copy, and nothing is pasted twice by one press
    await chord('v');
    await expect(editor.elements).toHaveCount(3);
    await page.waitForTimeout(400);
    await expect(editor.elements).toHaveCount(3);
  });

  test('FR-EDT-007: Ctrl+X with no clipboard event cuts, and Ctrl+V brings it back', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    const chord = (key: string) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true })), key);
    await chord('x');
    await expect(editor.elements).toHaveCount(0);
    await chord('v');
    await expect(editor.elements).toHaveCount(1);
  });

  test('FR-EDT-007: in a text field the key is the field’s own and the editor does nothing on top', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    await dragOut(page, editor, 'Shape');
    await expect(editor.elements).toHaveCount(1);
    const chord = (key: string) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true })), key);
    // the editor holds a copy, so a paste that reached it would add an element
    await chord('c');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const field = document.createElement('input');
      document.body.append(field);
      field.focus();
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    });
    await page.waitForTimeout(300);
    await expect(editor.elements).toHaveCount(1);
  });
});
