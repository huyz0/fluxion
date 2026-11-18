import type { Locator } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** The `--fx-color-<role>` the shown screen defines (the theme's CSS variable on `.fx-screen`). */
const screenColor = (editor: EditorPage, role: string): Promise<string> =>
  editor.screens.first().evaluate((el, r) => getComputedStyle(el).getPropertyValue(`--fx-color-${r}`).trim(), role);

/** The computed fill of the first shape's outline. */
const shapeFill = (editor: EditorPage): Promise<string> =>
  editor.shapes
    .first()
    .locator('.fx-outline')
    .first()
    .evaluate((el) => getComputedStyle(el).fill);

/**
 * Pick `hex` in the colour input as a picker does (one `input` event), and read `role`'s variable on the shown screen and the first
 * shape's fill in the next animation frame: what the canvas shows one frame after the pick.
 */
const pickAndReadNextFrame = (colour: Locator, hex: string, role: string) =>
  colour.evaluate(
    (el, [value, r]) =>
      new Promise<{ variable: string; fill: string }>((resolve) => {
        const input = el as HTMLInputElement;
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        requestAnimationFrame(() => {
          const screen = document.querySelector('.fx-screen') as HTMLElement;
          const outline = document.querySelector('.fx-el[data-kind="shape"] .fx-outline') as Element;
          resolve({ variable: getComputedStyle(screen).getPropertyValue(`--fx-color-${r}`).trim(), fill: getComputedStyle(outline).fill });
        });
      }),
    [hex, role] as const,
  );

// a colour picker beside the canvas: desktop input
test.describe('theme editor', { tag: '@desktop' }, () => {
  test('FR-THM-007: changing primary in the theme editor recolours the canvas within one frame, undoable in one step', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const before = await screenColor(editor, 'primary');
    await editor.toolbarButton('Edit theme').click();
    const panel = editor.themeEditor;
    await expect(panel).toBeVisible();
    // the canvas stays in view beside the panel
    await expect(editor.screens.first()).toBeVisible();
    await expectAccessible();

    const primary = panel.getByLabel('primary colour', { exact: true });
    const next = await pickAndReadNextFrame(primary, '#e11d48', 'primary');
    expect(next.variable).toBe('#e11d48');
    expect(next.variable).not.toBe(before);
    await primary.blur();
    // the shapes draw on the surface colour: a pick of it repaints them in the next frame too
    const fill = await shapeFill(editor);
    const surface = panel.getByLabel('surface colour', { exact: true });
    const repainted = await pickAndReadNextFrame(surface, '#fde68a', 'surface');
    expect(repainted.fill).toBe('rgb(253, 230, 138)');
    expect(repainted.fill).not.toBe(fill);
    await surface.blur();
    await expectAccessible();

    // each pick is one undo step
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => shapeFill(editor)).toBe(fill);
    expect(await screenColor(editor, 'primary')).toBe('#e11d48');
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => screenColor(editor, 'primary')).toBe(before);
    await expect(primary).toHaveValue(before);
  });

  test('FR-THM-009: the theme editor exports the theme file and its CSS, and imports a foreign DTCG file onto the canvas in one undo step', async ({
    page,
    expectAccessible,
  }) => {
    const editor = new EditorPage(page);
    await editor.open('example-shapes-gallery');
    const before = await screenColor(editor, 'primary');
    await editor.toolbarButton('Edit theme').click();
    const panel = editor.themeEditor;
    await expect(panel).toBeVisible();

    const [tokens] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export theme file', exact: true }).click()]);
    expect(tokens.suggestedFilename()).toMatch(/^[a-z0-9-]+\.tokens\.json$/);
    const [css] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export CSS', exact: true }).click()]);
    expect(css.suggestedFilename()).toMatch(/^[a-z0-9-]+\.css$/);

    const foreign = { color: { brand: { $type: 'color', $value: '#7c3aed' }, primary: { $type: 'color', $value: '{color.brand}' } } };
    await panel
      .getByLabel('Import theme file')
      .setInputFiles({ name: 'brand.tokens.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(foreign)) });
    await expect(panel.getByText(/^Imported /)).toBeVisible();
    await expect.poll(() => screenColor(editor, 'primary')).not.toBe(before);
    await expect(panel.getByLabel('primary colour', { exact: true })).toHaveValue('#7c3aed');
    await expect(panel.getByRole('list', { name: 'Theme file warnings' })).toBeVisible();
    await expectAccessible();

    await editor.toolbarButton('Undo').click();
    await expect.poll(() => screenColor(editor, 'primary')).toBe(before);
  });
});
