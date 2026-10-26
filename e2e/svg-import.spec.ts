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
for (const { name, source } of cases) {
  test(`FR-LIB-004: frozen SVG ${name} has actual isolated renderer paint @desktop`, async ({ page, blocked }, info) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => Object.assign(window, { __FLUXION_TEST_HOOKS__: true }));
    await new EditorPage(page).open('new');
    await loadImportFont(page);
    let witnessFailure: unknown;
    const result = await importSvgShape(source, {
      id: 'test:imported',
      fonts: [importFace],
      defaultFont: importFace.sha256,
      witness: async (request) => {
        try {
          await mountImportPaint(page, request);
          await page.keyboard.press('F5');
          const { receipt, screenshots } = await observeImportPaint(page, request);
          expect(receipt.status).toBe('painted');
          await info.attach('isolated-artwork-black', { body: screenshots[0], contentType: 'image/png' });
          await info.attach('isolated-artwork-white', { body: screenshots[1], contentType: 'image/png' });
          await compareImportSource(page, source, request, { actual: screenshots, controls: name === 'lucide-accessibility.svg' });
          return receipt;
        } catch (error) {
          witnessFailure = error;
          throw error;
        }
      },
    });
    expect(witnessFailure).toBeUndefined();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(blocked).toEqual([]);
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
