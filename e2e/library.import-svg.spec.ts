import { readdirSync, readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { writeZip } from '../packages/format/src/zip.js';
import { EditorPage } from './pages/editor.js';
import { asPicker, pickers, writes } from './pages/file-pickers.js';
import { expect, test } from './test.js';

const CORPUS = 'specs/import/corpus';
type Manifest = {
  sources: { id: string; license: string; attribution: string; notice: string; repository: string; commit: string; originalStatement?: string }[];
  svg: { path: string; source: string; sha256: string; upstreamPath?: string }[];
};
const manifest = JSON.parse(readFileSync(`${CORPUS}/manifest.json`, 'utf8')) as Manifest;
const member = (path: string) => path.slice('svg/'.length);
const names = readdirSync(`${CORPUS}/svg`)
  .filter((name) => name.endsWith('.svg'))
  .sort();

/** The corpus ZIP: every member at the archive's root. */
function corpusZip(): Buffer {
  const zip = writeZip(names.map((name) => ({ name, bytes: new Uint8Array(readFileSync(`${CORPUS}/svg/${name}`)) })));
  if (!zip.ok) throw new Error(zip.error.reason);
  return Buffer.from(zip.value);
}

/** The corpus's rights as a credits file (the CLI's format, notices inline), built from its manifest; `leaveOut` drops one member's credit. */
function corpusCredits(leaveOut?: string): Buffer {
  const source = (id: string) => manifest.sources.find((s) => s.id === id) as Manifest['sources'][number];
  const notice = (s: Manifest['sources'][number]) => readFileSync(`${CORPUS}/${s.notice}`, 'utf8');
  const [lucide, original] = [source('lucide'), source('fluxion-original')];
  const credits = {
    license: 'ISC AND MIT',
    attribution: 'Lucide Icons and Contributors; Fluxion contributors',
    credits: [
      ...manifest.svg
        .filter((e) => e.source === 'lucide' && member(e.path) !== leaveOut)
        .map((e) => ({
          id: member(e.path).replace(/\.svg$/, ''),
          license: lucide.license,
          attribution: lucide.attribution,
          notice: notice(lucide),
          source: { kind: 'upstream', reference: `${lucide.repository}@${lucide.commit}:${e.upstreamPath}`, sha256: e.sha256 },
          members: [member(e.path)],
        })),
      {
        id: 'fluxion',
        license: original.license,
        attribution: original.attribution,
        notice: notice(original),
        source: { kind: 'original', author: 'Fluxion contributors', statement: original.originalStatement },
        members: manifest.svg.filter((e) => e.source === 'fluxion-original').map((e) => member(e.path)),
      },
    ],
  };
  return Buffer.from(JSON.stringify(credits));
}

/** The editor on a new document with the library tab open; saves go to the in-memory picker. */
async function libraryOf(page: Page): Promise<{ editor: EditorPage; library: Locator }> {
  await pickers(page, asPicker('unused.flux', new Uint8Array()));
  const editor = new EditorPage(page);
  await editor.open('new');
  const library = editor.panel('Screens, library and layers');
  await library.getByRole('tab', { name: 'Library', exact: true }).click();
  return { editor, library };
}

/** Pick `files` under **Import SVG…**; the dialog it opens. */
async function pick(page: Page, library: Locator, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser');
  await library.getByRole('button', { name: 'Import SVG…', exact: true }).click();
  await (await chooser).setFiles(files);
  return page.getByRole('dialog', { name: 'Import SVG' });
}

/** Declare the corpus credits file in `dialog`, waiting until its text is read. */
async function declareCredits(dialog: Locator, credits: Buffer): Promise<void> {
  await dialog.getByRole('combobox', { name: 'Rights', exact: true }).selectOption('credits');
  const input = dialog.getByLabel('Credits file (JSON, notices inline)');
  await input.setInputFiles({ name: 'credits.json', mimeType: 'application/json', buffer: credits });
  await expect(dialog.getByText('Read credits.json', { exact: true })).toBeVisible();
}

const zip = () => ({ name: 'corpus.zip', mimeType: 'application/zip', buffer: corpusZip() });

// a file picker, a dialog and the saved file's reopen: desktop input; the witness runs in each engine's own renderer
test.describe('library SVG import', { tag: '@desktop' }, () => {
  test('FR-LIB-004 NFR-LIC-003: the 50-SVG corpus ZIP under its credits registers 50 shapes, a picked one inserts, and a save reopens drawing it', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    expect(names).toHaveLength(50);
    const { editor, library } = await libraryOf(page);
    const dialog = await pick(page, library, [zip()]);
    await expect(dialog.getByLabel('Namespace', { exact: true })).toHaveValue('corpus');
    await declareCredits(dialog, corpusCredits());
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog.getByText('50 shapes are ready')).toBeVisible({ timeout: 200_000 });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByText('Imported 50 shapes')).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // listed under its pack, and a picked one is inserted and drawn
    const pack = library.getByRole('region', { name: 'Pack corpus' });
    await expect(pack.locator('.fx-chrome-library-item')).toHaveCount(50);
    await pack.locator('[data-def-id="corpus:original-donut"] button').click();
    await expect(editor.screens.first().locator('.fx-artwork')).toHaveCount(1);

    // the save keeps the pack: reopened elsewhere, the shape is drawn from the file alone
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    const saved = (await writes(page))[0]?.bytes ?? new Uint8Array();
    const reopened = await context.newPage();
    await pickers(reopened, asPicker('imported.flux', saved));
    await reopened.goto('/');
    await reopened.getByRole('button', { name: 'Open a file…' }).click();
    const again = new EditorPage(reopened);
    await again.screens.first().waitFor();
    await expect(again.screens.first().locator('.fx-artwork')).toHaveCount(1);
    await expect(again.screens.first().locator('.fx-artwork path').first()).toHaveAttribute('d', /\S/);
  });

  test('FR-LIB-004 NFR-LIC-003: a member no credit names is refused by its path, and nothing is registered', async ({ page }) => {
    const { library } = await libraryOf(page);
    const dialog = await pick(page, library, [zip()]);
    await declareCredits(dialog, corpusCredits('lucide-activity.svg'));
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    const refusals = dialog.getByRole('alert').locator('li');
    await expect(refusals).toHaveCount(1);
    await expect(refusals.first()).toHaveAttribute('data-path', 'lucide-activity.svg');
    await expect(refusals.first()).toContainText('no credit names it');
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(library.getByRole('region', { name: 'Pack corpus' })).toHaveCount(0);
  });

  test('FR-LIB-004: a literal color mapped to a theme token is re-witnessed and drawn through the token, following a theme change', async ({ page }) => {
    test.setTimeout(120_000);
    const { editor, library } = await libraryOf(page);
    const donut = { name: 'original-donut.svg', mimeType: 'image/svg+xml', buffer: readFileSync(`${CORPUS}/svg/original-donut.svg`) };
    const dialog = await pick(page, library, [donut]);
    await dialog.getByRole('combobox', { name: 'License', exact: true }).selectOption('MIT');
    await dialog.getByLabel('Attribution', { exact: true }).fill('Fluxion contributors');
    await dialog.getByLabel('Author', { exact: true }).fill('Fluxion contributors');
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog.getByText('1 shape is ready')).toBeVisible({ timeout: 60_000 });
    await dialog.getByLabel('Token for #2878c8', { exact: true }).selectOption('{color.primary}');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByText('Imported 1 shape')).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    await library.locator('[data-def-id="original-donut:original-donut"] button').click();
    const path = editor.screens.first().locator('.fx-artwork path').first();
    const fill = () => path.evaluate((p) => getComputedStyle(p).fill);
    // light's primary, not the color as written
    await expect.poll(fill).toBe('rgb(37, 99, 235)');
    await editor.root.getByLabel('Theme', { exact: true }).selectOption({ label: 'dark' });
    await expect.poll(fill).not.toBe('rgb(37, 99, 235)');
    expect(await fill()).not.toBe('rgb(40, 120, 200)');
  });
});
