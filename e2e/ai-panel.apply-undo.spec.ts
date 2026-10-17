import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

// FR-EDT-014: the AI panel previews a recorded model reply on a fork of the document (a ghost overlay and a change list), Apply adds the
// elements as one undo step, and nothing reaches the document before Apply.
type Hooks = { recordedReply(text: string): void; records(): { [id: string]: { type: string } } };

test.describe('AI assistant panel', { tag: '@desktop' }, () => {
  test('FR-EDT-014: the preview shows a ghost and a change list, Apply adds the elements, one undo removes them all', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    await pickers(page, asPicker('deck.flux', await fluxFileOf('two-rects-line')));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    const editor = new EditorPage(page);
    await editor.screens.first().waitFor();

    const elements = () =>
      page.evaluate(() => Object.values((window as unknown as { __fluxion: Hooks }).__fluxion.records()).filter((r) => r.type === 'element').length);
    const before = await elements();
    const reply = await page.evaluate(() => {
      const hooks = (window as unknown as { __fluxion: Hooks }).__fluxion;
      const screen = Object.entries(hooks.records()).find(([, r]) => r.type === 'screen')?.[0];
      const patch = {
        flux: 1,
        ops: [
          { op: 'add', screen: `#${screen}`, slug: 'cache-one', node: { shape: 'rect', label: 'Cache one' } },
          { op: 'add', screen: `#${screen}`, slug: 'cache-two', node: { shape: 'rect', label: 'Cache two' } },
        ],
      };
      hooks.recordedReply(`Here is the patch:\n\`\`\`json\n${JSON.stringify(patch)}\n\`\`\``);
      return JSON.stringify(patch);
    });
    expect(reply).toContain('cache-one');

    await page.getByRole('button', { name: 'AI assistant' }).click();
    const panel = page.getByRole('complementary', { name: 'AI assistant' });
    await panel.getByLabel('What should change?').fill('Add two caches');
    await panel.getByRole('button', { name: 'Ask' }).click();

    // the preview: a ghost overlay with the new boxes and a change list, and the document untouched
    await expect(panel.getByRole('img', { name: 'Preview of the change' })).toBeVisible();
    await expect(panel.locator('rect[data-state="added"]')).toHaveCount(2);
    await expect(panel.getByRole('list', { name: 'Changes' }).getByText('Cache one')).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Changes' }).getByText('Cache two')).toBeVisible();
    expect(await elements()).toBe(before);

    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(elements).toBe(before + 2);

    // one undo takes both back
    await page.getByRole('main', { name: 'Canvas' }).press('Control+z');
    await expect.poll(elements).toBe(before);
  });
});
