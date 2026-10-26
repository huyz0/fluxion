import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importSvgBatch } from '../packages/format/src/svg-batch.js';
import type { SvgPaintRequest, SvgPaintWitness } from '../packages/format/src/svg-import-types.js';
import { LIGHT_THEME } from '../packages/theme/src/light.js';
import { expect, test } from './test.js';

const directory = 'specs/import/corpus/svg';
const names = readdirSync(directory)
  .filter((name) => name.endsWith('.svg'))
  .sort();
expect(names).toHaveLength(50);
const files = names.map((path) => ({ path, bytes: new Uint8Array(readFileSync(`${directory}/${path}`)) }));
const ids = Object.fromEntries(names.map((name, index) => [name, `corpus:shape-${index}`]));
const bytes = new Uint8Array(readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
const face = { family: 'FluxionImportPinnedInter', weight: 400 as const, style: 'normal' as const, sha256: createHash('sha256').update(bytes).digest('hex') };

async function qualify(witness: SvgPaintWitness): Promise<void> {
  const observations: SvgPaintRequest[] = [];
  const report = await importSvgBatch(
    { kind: 'files', files },
    {
      ids,
      fonts: [face],
      defaultFont: face.sha256,
      witness: async (request) => {
        observations.push(request);
        const receipt = await witness(request);
        expect(receipt).toEqual({ identity: request.identity, status: 'painted', fontHashes: request.fonts.map((font) => font.sha256) });
        return receipt;
      },
    },
  );
  expect(report.status, JSON.stringify(report)).toBe('processed');
  if (report.status !== 'processed') throw Error('corpus preflight failed');
  expect(report.inputCount).toBe(50);
  expect(report.acceptedCount, JSON.stringify(report.inputs.filter((input) => input.status !== 'accepted'))).toBe(50);
  expect(report.inputs.map((input) => input.path)).toEqual(names);
  expect(observations).toHaveLength(50);
  expect(observations.some((request) => request.fonts.length > 0)).toBe(true);
  for (const attribute of ['visibility="hidden"', 'opacity="0"']) {
    const source = `<svg viewBox="0 0 100 100"><rect width="100" height="100" ${attribute}/></svg>`;
    let calls = 0;
    let receiptStatus: string | undefined;
    const refused = await importSvgBatch(
      { kind: 'files', files: [{ path: 'hidden.svg', bytes: new TextEncoder().encode(source) }] },
      {
        ids: { 'hidden.svg': 'corpus:hidden' },
        witness: async (request) => {
          calls++;
          const receipt = await witness(request);
          receiptStatus = receipt.status;
          return receipt;
        },
      },
    );
    expect(calls).toBe(1);
    expect(receiptStatus).toBe('no-witness');
    expect(refused.status).toBe('processed');
    if (refused.status === 'processed') expect(refused.acceptedCount).toBe(0);
  }
}

test('FR-LIB-004 NFR-SEC-001: public Node witness qualifies all 50 frozen SVGs and negative controls @desktop', async ({ browserName }, info) => {
  test.setTimeout(180000);
  const directory = mkdtempSync(join(tmpdir(), 'fluxion-witness-corpus-'));
  try {
    const input = join(directory, 'corpus.json');
    writeFileSync(
      input,
      JSON.stringify({
        files: files.map((file) => ({ ...file, bytes: Array.from(file.bytes) })),
        ids,
        theme: LIGHT_THEME,
        font: { ...face, profile: 'inter-latin-400-ascii', bytes: Array.from(bytes) },
        engine: browserName,
      }),
    );
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./pages/svg-witness-node-corpus.mjs', import.meta.url)), input], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 170000,
      env: {
        ...process.env,
        FLUXION_WITNESS_MODULE: pathToFileURL(resolve('packages/cli/dist/svg-witness.js')).href,
        FLUXION_FORMAT_MODULE: pathToFileURL(resolve('packages/format/dist/index.js')).href,
      },
    });
    await info.attach('node-host-corpus-output', { body: `${result.stdout}\n${result.stderr}`, contentType: 'text/plain' });
    expect(result.status, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ engine: browserName, accepted: 50, negatives: 2, fontObserved: true, disposed: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('FR-LIB-004 NFR-SEC-001: shipped browser witness qualifies all 50 frozen SVGs and negative controls @desktop', async ({ page, blocked }) => {
  test.setTimeout(180000);
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: readFileSync('packages/cli/dist/svg-witness.browser.js', 'utf8') });
  await page.evaluate(
    ({ theme, face, data }) => {
      const api = (window as unknown as { FluxionSvgWitness: typeof import('../packages/render/src/svg-witness.js') }).FluxionSvgWitness;
      const made = api.createSvgPaintWitness({ document, theme, fonts: [{ ...face, bytes: new Uint8Array(data), profile: 'inter-latin-400-ascii' }] });
      if (!made.ok) throw Error('browser witness construction failed');
      Object.assign(window, { corpusSession: made.value });
    },
    { theme: LIGHT_THEME, face, data: Array.from(bytes) },
  );
  try {
    await qualify((request) =>
      page.evaluate((request) => {
        const session = (window as unknown as { corpusSession: import('../packages/render/src/svg-witness.js').SvgWitnessSession }).corpusSession;
        return session.witness(request);
      }, request),
    );
  } finally {
    await page.evaluate(() =>
      (window as unknown as { corpusSession: import('../packages/render/src/svg-witness.js').SvgWitnessSession }).corpusSession.dispose(),
    );
  }
  expect(await page.locator('[data-fluxion-svg-witness]').count()).toBe(0);
  expect(blocked).toEqual([]);
});
