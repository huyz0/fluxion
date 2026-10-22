import { EditorPage } from './pages/editor.js';
import { asPicker, pickers } from './pages/file-pickers.js';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

// FR-AI-007: the AI panel takes a provider key and an OpenAI-compatible base URL, the next request goes to that server with that key, and the
// "embed external images" toggle is kept across a reload.
type Hooks = { records(): { [id: string]: { type: string } } };

const BASE_URL = 'http://llm.fluxion.test/v1';
const KEY = 'sk-fluxion-e2e-0123456789';

test.describe('AI panel settings', { tag: '@desktop' }, () => {
  test('FR-AI-007: a key and base URL are saved and used for the next request; the embed toggle is kept', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FLUXION_TEST_HOOKS__: boolean }).__FLUXION_TEST_HOOKS__ = true;
    });
    const seen: Array<{ url: string; authorization: string | undefined; model: unknown }> = [];
    await page.route(`${BASE_URL}/**`, async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const headers = route.request().headers();
      seen.push({ url: route.request().url(), authorization: headers['authorization'], model: (route.request().postDataJSON() as { model?: unknown }).model });
      const screen = await page.evaluate(
        () => Object.entries((window as unknown as { __fluxion: Hooks }).__fluxion.records()).find(([, r]) => r.type === 'screen')?.[0],
      );
      const patch = { flux: 1, ops: [{ op: 'add', screen: `#${screen}`, slug: 'cache-one', node: { shape: 'rect', label: 'Cache one' } }] };
      const content = `\`\`\`json\n${JSON.stringify(patch)}\n\`\`\``;
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
    });
    await pickers(page, asPicker('deck.flux', await fluxFileOf('two-rects-line')));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await new EditorPage(page).screens.first().waitFor();

    await page.getByRole('button', { name: 'AI assistant' }).click();
    const panel = page.getByRole('complementary', { name: 'AI assistant' });
    const settings = panel.getByRole('group', { name: 'AI settings' });
    // a base URL with a trailing slash; the key entered with it is kept as the OpenAI key, which the compatible server is asked with
    await settings.getByLabel('API key').fill(KEY);
    await settings.getByLabel('Base URL (OpenAI-compatible)').fill(`${BASE_URL}/`);
    await expect(settings.getByLabel('Provider')).toBeDisabled();
    await settings.getByLabel('Model').fill('local-model');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByRole('status')).toContainText('Saved');
    // the key is not kept in the field once saved
    await expect(settings.getByLabel('API key')).toHaveValue('');

    await panel.getByLabel('What should change?').fill('Add a cache');
    await panel.getByRole('button', { name: 'Ask' }).click();
    await expect(panel.getByRole('img', { name: 'Preview of the change' })).toBeVisible();
    expect(seen).toEqual([{ url: `${BASE_URL}/chat/completions`, authorization: `Bearer ${KEY}`, model: 'local-model' }]);
    // the key never reaches the page's settings storage
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(KEY);

    await settings.getByLabel('Embed external images when saving').check();
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await new EditorPage(page).screens.first().waitFor();
    await page.getByRole('button', { name: 'AI assistant' }).click();
    const again = page.getByRole('complementary', { name: 'AI assistant' }).getByRole('group', { name: 'AI settings' });
    await expect(again.getByLabel('Embed external images when saving')).toBeChecked();
    await expect(again.getByLabel('Base URL (OpenAI-compatible)')).toHaveValue(BASE_URL);
  });
});
