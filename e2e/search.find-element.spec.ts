import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

/** A shape clicked onto the shown screen at `at` (fractions of its size), its text set to `text`. */
async function shapeWith(editor: EditorPage, at: { readonly fx: number; readonly fy: number }, text: string): Promise<void> {
  const { page } = editor;
  const { fx, fy } = at;
  const screen = await editor.screenBox();
  const before = await editor.shapes.count();
  await editor.toolButton('Shape').click();
  await page.mouse.click(screen.x + screen.width * fx, screen.y + screen.height * fy);
  await expect(editor.shapes).toHaveCount(before + 1);
  const box = await editor.shapes.nth(before).boundingBox();
  if (box === null) throw new Error('the shape is not drawn');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editor.canvas.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor.shapes.nth(before).locator('.fx-label')).toHaveText(text);
}

// the editor's keys and the pointer: desktop input
test.describe('element search', { tag: '@desktop' }, () => {
  test.setTimeout(90_000);

  test('FR-EDT-016: Ctrl/Cmd+F highlights every match; Enter jumps to the next, crossing screens', async ({ page, expectAccessible }) => {
    const editor = new EditorPage(page);
    await editor.open('new');
    const screens = editor.panel('Screens, library and layers');
    await screens.getByRole('button', { name: 'New screen', exact: true }).click();
    await editor.screenTab('Screen 1').click();
    await shapeWith(editor, { fx: 0.25, fy: 0.3 }, 'Login');
    await shapeWith(editor, { fx: 0.7, fy: 0.6 }, 'Sign up');
    await shapeWith(editor, { fx: 0.25, fy: 0.7 }, 'Login help');
    await editor.screenTab('Screen 2').click();
    await shapeWith(editor, { fx: 0.5, fy: 0.5 }, 'Login again');
    await editor.screenTab('Screen 1').click();
    await editor.toolButton('Select').click();

    await editor.canvas.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+f');
    const bar = editor.root.getByRole('search', { name: 'Find elements', exact: true });
    const input = bar.getByRole('searchbox', { name: 'Find by text or label', exact: true });
    await expect(input).toBeFocused();
    await input.fill('login');
    // Ctrl/Cmd+F again selects the query, the browser's own find staying shut
    await input.press('ControlOrMeta+f');
    expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 5]);
    // the two matches on this screen are highlighted; Sign up is not
    const marks = editor.canvas.locator('[data-find-match]');
    await expect(marks).toHaveCount(2);
    await expect(bar.locator('output')).toHaveText('3 matches');
    await expectAccessible();

    await input.press('Enter');
    await expect(bar.locator('output')).toHaveText('1 of 3');
    await expect(editor.canvas.locator('.fx-chrome-find-current')).toHaveCount(1);
    await input.press('Enter');
    await expect(bar.locator('output')).toHaveText('2 of 3');
    // the third match is on Screen 2: Enter shows that screen with it highlighted
    await input.press('Enter');
    await expect(bar.locator('output')).toHaveText('3 of 3');
    await expect(editor.screenTab('Screen 2')).toHaveAttribute('aria-pressed', 'true');
    await expect(marks).toHaveCount(1);
    await expect(editor.shapes.first().locator('.fx-label')).toHaveText('Login again');
    // and on round to the first again
    await input.press('Enter');
    await expect(bar.locator('output')).toHaveText('1 of 3');
    await expect(marks).toHaveCount(2);
    await expectAccessible();

    // the bar is not modal: the canvas still copies and pastes the selected match while it is open
    const login = await editor.shapes.first().boundingBox();
    if (login === null) throw new Error('the match is not drawn');
    await page.mouse.click(login.x + login.width / 2, login.y + login.height / 2);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(editor.shapes).toHaveCount(4);
    await expect(bar).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.shapes).toHaveCount(3);

    await input.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(marks).toHaveCount(0);
  });
});
