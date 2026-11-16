import { readdirSync, readFileSync } from 'node:fs';
import { importSvgShape } from '../packages/format/src/svg-import.js';
import { EditorPage } from './pages/editor.js';
import { compareImportSource, importFace, loadImportFont, mountImportPaint, observeImportPaint } from './pages/svg-import-corpus.js';
import { expect, test } from './test.js';

const directory = 'specs/import/corpus/svg';
const names = readdirSync(directory)
  .filter((name) => name.endsWith('.svg'))
  .sort();
expect(names).toHaveLength(50);
const cases = [
  ...names.map((name) => ({ name, source: readFileSync(`${directory}/${name}`, 'utf8') })),
  {
    name: 'viewport-offset-percentage',
    source: '<svg width="200" height="100" viewBox="10 20 100 50"><rect x="25%" y="25%" width="50%" height="50%" fill="red"/></svg>',
  },
  { name: 'viewport-aspect-fit', source: '<svg width="200" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>' },
];
// M19.56: the cases run in batches, one editor per batch (an editor open costs a few seconds on Firefox and WebKit), each case its own
// step with every assertion it had as its own test; the batch's budget is 15 s a case, under the 30 s each case had alone
const BATCH = 6;
const batches = Array.from({ length: Math.ceil(cases.length / BATCH) }, (_, i) => cases.slice(i * BATCH, (i + 1) * BATCH));
for (const [b, batch] of batches.entries()) {
  test(`FR-LIB-004: frozen SVGs batch ${b + 1}/${batches.length} (${batch[0]?.name} to ${batch.at(-1)?.name}) have actual isolated renderer paint @desktop`, async ({
    page,
    blocked,
  }, info) => {
    test.setTimeout(batch.length * 15_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => Object.assign(window, { __FLUXION_TEST_HOOKS__: true }));
    await new EditorPage(page).open('new');
    await loadImportFont(page);
    for (const [i, { name, source }] of batch.entries()) {
      await test.step(name, async () => {
        let witnessFailure: unknown;
        const result = await importSvgShape(source, {
          id: 'test:imported',
          fonts: [importFace],
          defaultFont: importFace.sha256,
          witness: async (request) => {
            try {
              await mountImportPaint(page, request, b * BATCH + i + 1);
              await page.keyboard.press('F5');
              const { receipt, screenshots } = await observeImportPaint(page, request);
              expect(receipt.status).toBe('painted');
              await info.attach(`${name} isolated-artwork-black`, { body: screenshots[0], contentType: 'image/png' });
              await info.attach(`${name} isolated-artwork-white`, { body: screenshots[1], contentType: 'image/png' });
              await compareImportSource(page, source, request, { actual: screenshots, controls: name === 'lucide-accessibility.svg' });
              return receipt;
            } catch (error) {
              witnessFailure = error;
              throw error;
            } finally {
              // back to the editor for the next case
              await page.keyboard.press('Escape');
              await expect(page.getByTestId('present-in-place')).toHaveCount(0);
            }
          },
        });
        expect(witnessFailure).toBeUndefined();
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(blocked).toEqual([]);
      });
    }
  });
}

for (const attribute of ['visibility="hidden"', 'opacity="0"']) {
  test(`FR-LIB-004: authored ${attribute} cannot manufacture a paint witness @desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => Object.assign(window, { __FLUXION_TEST_HOOKS__: true }));
    await new EditorPage(page).open('new');
    let receiptStatus: string | undefined;
    const result = await importSvgShape(`<svg viewBox="0 0 100 100"><rect width="100" height="100" ${attribute}/></svg>`, {
      id: 'test:invisible',
      witness: async (request) => {
        await mountImportPaint(page, request);
        await page.keyboard.press('F5');
        const { receipt } = await observeImportPaint(page, request);
        receiptStatus = receipt.status;
        return receipt;
      },
    });
    expect(receiptStatus).toBe('no-witness');
    expect(result.ok).toBe(false);
  });
}
