import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

const PANEL = 'Screens, library and layers';

/** The navigator's lines in order: a section as `# name`, a screen as its label. */
const lines = (editor: EditorPage): Promise<string[]> =>
  editor
    .panel(PANEL)
    .locator('ul[aria-label="Screens"] > li')
    .evaluateAll((all) =>
      all.map((li) =>
        li.hasAttribute('data-section-id')
          ? `# ${li.querySelector('button')?.getAttribute('aria-label')?.replace('Section ', '') ?? li.querySelector('input')?.getAttribute('aria-label')}`
          : (li.querySelector(':scope > button span')?.textContent ?? '?'),
      ),
    );

/** A new document with three screens and one section, "Section 1". */
async function withSection(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.open('new');
  const panel = editor.panel(PANEL);
  await panel.getByRole('button', { name: 'New screen', exact: true }).click();
  await panel.getByRole('button', { name: 'New screen', exact: true }).click();
  await panel.getByRole('button', { name: 'New section', exact: true }).click();
  await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Section 1']);
  return editor;
}

// drag and drop, double-click and menus: desktop input
test.describe('sections in the navigator', { tag: '@desktop' }, () => {
  test('FR-SCR-004: screens group into a section, fold with it and move between sections, each change one undo step', async ({ page }) => {
    const editor = await withSection(page);
    const panel = editor.panel(PANEL);
    // a screen is moved into the section by its menu: the screens in no section stay first
    await editor.screenTab('Screen 2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to section: Section 1' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1', 'Screen 2']);
    // the header folds its screens away and unfolds them again
    const header = panel.getByRole('button', { name: 'Section Section 1' });
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1']);
    await header.click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1', 'Screen 2']);
    // a screen dragged onto the header joins the section
    await panel.locator('.fx-chrome-screen', { hasText: 'Screen 3' }).dragTo(panel.locator('.fx-chrome-section'));
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', '# Section 1', 'Screen 2', 'Screen 3']);
    // one undo step takes it back out, and redo puts it back
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1', 'Screen 2']);
    await editor.toolbarButton('Redo').click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', '# Section 1', 'Screen 2', 'Screen 3']);
    // out of the section again, by the menu
    await editor.screenTab('Screen 2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from section' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', '# Section 1', 'Screen 3']);
  });

  test('FR-SCR-004: a screen dropped on a row of another section moves into it, in one undo step', async ({ page }) => {
    const editor = await withSection(page);
    const panel = editor.panel(PANEL);
    await editor.screenTab('Screen 2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to section: Section 1' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1', 'Screen 2']);
    // dropped on the row of Screen 2: it joins that section, above it
    await panel.locator('.fx-chrome-screen', { hasText: 'Screen 1' }).dragTo(panel.locator('.fx-chrome-screen', { hasText: 'Screen 2' }));
    await expect.poll(() => lines(editor)).toEqual(['Screen 3', '# Section 1', 'Screen 1', 'Screen 2']);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 3', '# Section 1', 'Screen 2']);
    // and on a row of no section it leaves its own
    await panel.locator('.fx-chrome-screen', { hasText: 'Screen 2' }).dragTo(panel.locator('.fx-chrome-screen', { hasText: 'Screen 3' }));
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Section 1']);
  });

  test('FR-SCR-004: a section is renamed, moved and deleted, and its screens go on being listed', async ({ page }) => {
    const editor = await withSection(page);
    const panel = editor.panel(PANEL);
    await panel.getByRole('button', { name: 'New section', exact: true }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Section 1', '# Section 2']);
    // rename in place
    await panel.getByRole('button', { name: 'Section Section 2' }).dblclick();
    const field = panel.getByRole('textbox', { name: 'Rename section Section 2' });
    await field.fill('Appendix');
    await field.press('Enter');
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Section 1', '# Appendix']);
    // up, by the section's menu
    await panel.getByRole('button', { name: 'Section Appendix' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move section up' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Appendix', '# Section 1']);
    // a screen in a section, then the section deleted: the screen is listed again, in no section
    await editor.screenTab('Screen 3').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to section: Appendix' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', '# Appendix', 'Screen 3', '# Section 1']);
    await panel.getByRole('button', { name: 'Section Appendix' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete section' }).click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', 'Screen 3', '# Section 1']);
    await editor.toolbarButton('Undo').click();
    await expect.poll(() => lines(editor)).toEqual(['Screen 1', 'Screen 2', '# Appendix', 'Screen 3', '# Section 1']);
  });
});
