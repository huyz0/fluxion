// FR-LIB-005 FR-LIB-006 FR-LIB-009 NFR-LIC-003: the studio's Import Iconify… and Import draw.io… (M18.210) turn the pinned Lucide
// collection (a subset of it: the full 2198 icons are converted in import-collection.test.ts, a four-minute witness per browser
// here) and the original draw.io library into packs that register, a save of a document using one of their shapes reopens
// offline drawing it and crediting it, and a collection without a licence, a library without its credit or a held namespace
// registers nothing and says why. A collection's category heads its shapes by the name it gives, before the save and after the
// reopen (M18.212).
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { expect, test } from './test.js';

const CORPUS = 'specs/import/corpus';
const file = (path: string, mimeType: string) => ({ name: path.split('/').at(-1) ?? path, mimeType, buffer: readFileSync(`${CORPUS}/${path}`) });
/** The pinned Lucide collection cut to `database` and the first 23 other icons, its aliases of those, and its own info. */
function lucide(): ReturnType<typeof file> {
  const whole = JSON.parse(readFileSync(`${CORPUS}/iconify/lucide.json`, 'utf8')) as {
    icons: Record<string, unknown>;
    aliases?: Record<string, { parent: string }>;
  };
  const kept = new Set([
    'database',
    ...Object.keys(whole.icons)
      .filter((n) => n !== 'database')
      .sort()
      .slice(0, 23),
  ]);
  const icons = Object.fromEntries(Object.entries(whole.icons).filter(([n]) => kept.has(n)));
  const aliases = Object.fromEntries(Object.entries(whole.aliases ?? {}).filter(([, a]) => kept.has(a.parent)));
  return { name: 'lucide.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...whole, icons, aliases })) };
}
const mixed = () => file('drawio/original-mixed.xml', 'application/xml');

/** The editor on a new document with the library tab open; saves go to the in-memory picker. */
async function libraryOf(page: Page): Promise<{ editor: EditorPage; library: Locator }> {
  await pickers(page, asPicker('unused.flux', new Uint8Array()));
  const editor = new EditorPage(page);
  await editor.open('new');
  const library = editor.panel('Screens, library and layers');
  await library.getByRole('tab', { name: 'Library', exact: true }).click();
  return { editor, library };
}

const ICONIFY = { entry: 'Import Iconify…', title: 'Import Iconify collection' } as const;
const DRAWIO = { entry: 'Import draw.io…', title: 'Import draw.io library' } as const;

/** Pick `picked` under the import entry `via`; the dialog it opens. */
async function pick(library: Locator, via: typeof ICONIFY | typeof DRAWIO, picked: ReturnType<typeof file>): Promise<Locator> {
  const page = library.page();
  const chooser = page.waitForEvent('filechooser');
  await library.getByRole('button', { name: via.entry, exact: true }).click();
  await (await chooser).setFiles(picked);
  return page.getByRole('dialog', { name: via.title });
}

/** Convert and import in `dialog`, `ready` shapes expected. */
async function convertAndImport(dialog: Locator, ready: RegExp, timeout: number): Promise<void> {
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(dialog.getByText(ready)).toBeVisible({ timeout });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByText(/^Imported [\d,]+ shapes?$/)).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Declare the person's own work under MIT in `dialog`. */
async function declareOwnWork(dialog: Locator): Promise<void> {
  await dialog.getByRole('combobox', { name: 'License', exact: true }).selectOption('MIT');
  await dialog.getByLabel('Attribution', { exact: true }).fill('Fluxion contributors');
  await dialog.getByLabel('Author', { exact: true }).fill('Fluxion contributors');
}

/** Save, reopen the saved bytes in a new page with the network refused, and return the reopened editor. */
async function saveAndReopenOffline(page: Page): Promise<EditorPage> {
  await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
  const reopened = await page.context().newPage();
  await pickers(reopened, asPicker('imported.flux', saved));
  await reopened.goto('/');
  // once the studio is loaded, nothing more may come from the network: the shapes and credits are the file's
  await reopened.route(/^https?:\/\/(?!(localhost|127\.0\.0\.1)[:/])/, (route) => route.abort());
  await reopened.getByRole('button', { name: 'Open a file…' }).click();
  const again = new EditorPage(reopened);
  await again.screens.first().waitFor();
  return again;
}

/** The reopened document's credits dialog. */
async function credits(editor: EditorPage): Promise<Locator> {
  await editor.toolbarButton('Credits').click();
  return editor.page.getByRole('dialog', { name: 'Shape credits' });
}

// a file picker, a dialog and the saved file's reopen: desktop input; the witness runs in each engine's own renderer
test.describe('library Iconify and draw.io import', { tag: '@desktop' }, () => {
  test('FR-LIB-005 FR-LIB-009 NFR-LIC-003: the pinned Lucide collection imports under its own licence, and a save reopens drawing and crediting a used icon', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { editor, library } = await libraryOf(page);
    const dialog = await pick(library, ICONIFY, lucide());
    // nothing to declare: the collection's own licence credits it
    await expect(dialog.getByRole('group')).toHaveCount(0);
    await convertAndImport(dialog, /^30 shapes are ready$/, 120_000);
    await library.getByRole('searchbox', { name: 'Search the library' }).fill('database');
    await library.locator('[data-def-id="lucide:database"] button').click();
    await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);

    const again = await saveAndReopenOffline(page);
    await expect(again.screens.first().locator('.fx-artwork path').first()).toHaveAttribute('d', /\S/);
    const list = await credits(again);
    await expect(list).toContainText('Lucide by Lucide Contributors');
    await expect(list).toContainText('Licence: ISC');
  });

  test('FR-LIB-006 FR-LIB-009 NFR-LIC-003: a draw.io library imports under its declared credit, and a save reopens drawing and crediting a used shape', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { editor, library } = await libraryOf(page);
    const dialog = await pick(library, DRAWIO, mixed());
    await expect(dialog.getByLabel('Namespace', { exact: true })).toHaveValue('original-mixed');
    await dialog.getByLabel('Name', { exact: true }).fill('Mixed');
    // a credit missing its parts is refused before anything converts
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Choose the license of the library.');
    await declareOwnWork(dialog);
    await convertAndImport(dialog, /^\d+ shapes? (is|are) ready$/, 120_000);
    const pack = library.getByRole('region', { name: 'Pack Mixed' });
    await pack.locator('.fx-chrome-library-item button').first().click();
    await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);

    // the namespace is held now: a second import registers nothing and says why
    const listed = await pack.locator('.fx-chrome-library-item').count();
    const twice = await pick(library, DRAWIO, mixed());
    await declareOwnWork(twice);
    await twice.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(twice.getByText(/^\d+ shapes? (is|are) ready$/)).toBeVisible({ timeout: 120_000 });
    await twice.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(twice.getByRole('alert')).toContainText('original-mixed');
    await twice.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(pack.locator('.fx-chrome-library-item')).toHaveCount(listed);

    const again = await saveAndReopenOffline(page);
    await expect(again.screens.first().locator('.fx-artwork path').first()).toHaveAttribute('d', /\S/);
    const list = await credits(again);
    await expect(list.getByRole('region', { name: 'Mixed' })).toContainText('Fluxion contributors. Licence: MIT');
  });

  test('FR-LIB-005 FR-LIB-009: a category is headed by the name its collection gives, before the save and after the reopen', async ({ page }) => {
    test.setTimeout(120_000);
    const { editor, library } = await libraryOf(page);
    const dialog = await pick(library, ICONIFY, {
      name: 'category-names.json',
      mimeType: 'application/json',
      buffer: readFileSync('fixtures/iconify/category-names.json'),
    });
    await convertAndImport(dialog, /^2 shapes are ready$/, 60_000);
    // the name, not the slug's title form 'Arrows Pointers'
    await expect(library.getByRole('heading', { name: 'Fluxion arrows / Arrows & Pointers', exact: true })).toBeVisible();
    await library.getByRole('searchbox', { name: 'Search the library' }).fill('pointers');
    await expect(library.locator('[data-def-id^="fluxion-arrows:"]')).toHaveCount(2);
    await library.locator('[data-def-id="fluxion-arrows:pointer"] button').click();
    await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);

    // a saved subset carries its category names but no pack name, so its namespace heads it
    const again = await saveAndReopenOffline(page);
    const reopened = again.panel('Screens, library and layers');
    await reopened.getByRole('tab', { name: 'Library', exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'fluxion-arrows / Arrows & Pointers', exact: true })).toBeVisible();
  });

  test('FR-LIB-005 NFR-LIC-003: a collection that declares no licence is refused, and nothing is registered', async ({ page }) => {
    const { library } = await libraryOf(page);
    const dialog = await pick(library, ICONIFY, file('iconify/original-aliases.json', 'application/json'));
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('declares no license; it cannot be saved portably');
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(library.locator('[data-def-id^="fluxion-corpus:"]')).toHaveCount(0);
  });
});
