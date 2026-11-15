// The boolean goldens in every engine (FR-SHP-010, ADR-0053, M19 cp1 F4): the golden cases module is bundled as it is and run in
// the page; Chromium, Firefox and WebKit must give the bytes Node gave (packages/geometry/src/__fixtures__/boolean-goldens.json),
// a turned and flipped operand included. Pure arithmetic in geometry makes them equal; a transcendental call would not.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test } from './test.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const goldens = JSON.parse(readFileSync(`${root}packages/geometry/src/__fixtures__/boolean-goldens.json`, 'utf8')) as Record<string, string>;

/** The cases module as one classic script defining `fluxionBooleanCases`. */
async function bundle(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    build: {
      write: false,
      minify: false,
      lib: { entry: `${root}packages/geometry/src/__fixtures__/boolean-cases.ts`, formats: ['iife'], name: 'fluxionBooleanCases' },
    },
  });
  const chunk = (Array.isArray(out) ? out[0] : out) as { output: readonly { type: string; code?: string }[] };
  return chunk.output.find((o) => o.type === 'chunk')?.code ?? '';
}

test('FR-SHP-010: each boolean golden gives the bytes Node gave', async ({ page }) => {
  const code = await bundle();
  await page.setContent('<!doctype html><title>boolean goldens</title>');
  await page.addScriptTag({ content: code });
  const got = await page.evaluate(() =>
    (globalThis as unknown as { fluxionBooleanCases: { runBooleanCases(): Record<string, string> } }).fluxionBooleanCases.runBooleanCases(),
  );
  expect(Object.keys(got).sort()).toEqual(Object.keys(goldens).sort());
  for (const [name, d] of Object.entries(goldens)) expect(got[name], name).toBe(d);
});
