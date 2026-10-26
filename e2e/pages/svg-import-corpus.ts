import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { SvgPaintReceipt, SvgPaintRequest } from '../../packages/format/src/svg-import-types.js';
import { expect, test } from '../test.js';
import { diffPct, PARITY_MAX_DIFF_PCT } from './image-diff.js';
import { type Capture, capturePaint, decoded, expectSamePaint, occupied, paintStructure } from './svg-import-capture.js';

const bytes = readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2');
export const importFace = {
  family: 'FluxionImportPinnedInter',
  weight: 400,
  style: 'normal' as const,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const coverage = JSON.parse(readFileSync('fixtures/artwork/inter-latin-400-coverage.json', 'utf8')) as { sha256: string; qualifiedRange: number[] };
expect(coverage.sha256).toBe(importFace.sha256);
expect(coverage.qualifiedRange).toEqual([32, 126]);
type Hooks = {
  registerShape(input: unknown): string | undefined;
  records(): Record<string, Record<string, unknown>>;
  applyRecords(puts: readonly object[]): string | undefined;
};

export async function loadImportFont(page: Page): Promise<void> {
  await page.evaluate(async (base64) => {
    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const face = new FontFace('FluxionImportPinnedInter', binary, { weight: '400', style: 'normal' });
    await face.load();
    document.fonts.add(face);
    if ([...document.fonts].filter((f) => f.family.replaceAll('"', '').replaceAll("'", '') === 'FluxionImportPinnedInter').length !== 1)
      throw new Error('Competing Inter faces');
    if (face.status !== 'loaded' || !document.fonts.check('400 20px FluxionImportPinnedInter', 'API')) throw new Error('Pinned Inter failed to load');
  }, bytes.toString('base64'));
}

export async function mountImportPaint(page: Page, request: SvgPaintRequest): Promise<void> {
  expect(request.fonts.every((f) => f.sha256 === importFace.sha256 && f.family === importFace.family && f.weight === 400 && f.style === 'normal')).toBe(true);
  expect(
    await page.evaluate(({ artwork, width, height }) => {
      const hooks = (window as unknown as { __fluxion: Hooks }).__fluxion;
      const failure = hooks.registerShape({
        id: 'test:import-witness',
        defaultSize: { w: width, h: height },
        artwork,
        outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
        anchors: [],
      });
      if (failure) return failure;
      const screen = Object.values(hooks.records()).find((r) => r['type'] === 'screen');
      return hooks.applyRecords([
        {
          id: 'ImportWitness01',
          type: 'element',
          kind: 'shape',
          screenId: screen?.['id'],
          index: 'a0',
          defId: 'test:import-witness',
          transform: { x: 0, y: 0, w: width, h: height },
        },
      ]);
    }, request),
  ).toBeUndefined();
}

export async function observeImportPaint(page: Page, request: SvgPaintRequest): Promise<{ receipt: SvgPaintReceipt; screenshots: Capture }> {
  const artwork = page.getByTestId('present-in-place').locator('.fx-artwork');
  await expect(artwork).toHaveCount(1);
  await expect.poll(() => page.getByTestId('present-in-place').locator('.fx-screen').boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  const clip = { x: 0, y: 0, width: request.width, height: request.height };
  await expect
    .poll(() =>
      artwork.evaluate((e) => {
        const r = e.closest('.fx-el')?.getBoundingClientRect();
        return r && { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    )
    .toEqual(clip);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
  const screenshots = await capturePaint(page, clip, '.fx-artwork');
  const disabled = await decoded(page, await capturePaint(page, clip, '.fx-artwork', '.fx-artwork{display:none!important}'));
  expect(occupied(disabled)).toBeUndefined();
  const images = await decoded(page, screenshots);
  for (const image of images) expect([image.w, image.h]).toEqual([request.width, request.height]);
  return {
    screenshots,
    receipt: { identity: request.identity, status: occupied(images) ? 'painted' : 'no-witness', fontHashes: request.fonts.map((f) => f.sha256) },
  };
}

export async function compareImportSource(
  page: Page,
  source: string,
  request: SvgPaintRequest,
  capture: { actual: Capture; controls: boolean },
): Promise<void> {
  const clip = { x: 0, y: 0, width: request.width, height: request.height };
  const actual = await decoded(page, capture.actual);
  if (request.fonts.length) {
    const without = await decoded(page, await capturePaint(page, clip, '.fx-artwork', '.fx-artwork text{display:none!important}'));
    expect(Math.max(diffPct(actual[0], without[0]), diffPct(actual[1], without[1]))).toBeGreaterThan(PARITY_MAX_DIFF_PCT);
  }
  const originalStructure = await paintStructure(page, '[data-testid="present-in-place"] .fx-artwork > svg');
  const currentColor = await page
    .getByTestId('present-in-place')
    .locator('.fx-artwork')
    .evaluate((e) => getComputedStyle(e).color);
  await page.evaluate(
    ({ source, width, height, viewBox, currentColor }) => {
      const context = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      // Native SVG fragment context also handles accepted roots without an explicit xmlns.
      context.innerHTML = source;
      const native = context.firstElementChild;
      if (!native) throw new Error('Native source root missing');
      const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrapper.setAttribute('id', 'native-import-reference');
      wrapper.setAttribute('width', String(width));
      wrapper.setAttribute('height', String(height));
      wrapper.setAttribute('viewBox', `0 0 ${viewBox.width} ${viewBox.height}`);
      wrapper.setAttribute('preserveAspectRatio', 'none');
      wrapper.setAttribute('font-family', 'FluxionImportPinnedInter');
      wrapper.setAttribute('font-weight', '400');
      wrapper.setAttribute('font-style', 'normal');
      wrapper.style.overflow = 'hidden';
      wrapper.style.color = currentColor;
      wrapper.append(document.importNode(native, true));
      const frame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      frame.id = 'native-import-frame';
      frame.setAttribute('width', String(width));
      frame.setAttribute('height', String(height));
      frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
      frame.style.cssText = 'position:fixed;left:0;top:0;display:block';
      frame.append(wrapper);
      document.body.append(frame);
    },
    { source, width: request.width, height: request.height, viewBox: request.artwork.viewBox, currentColor },
  );
  try {
    const structure = await paintStructure(page, '#native-import-reference > svg');
    expect(originalStructure).toEqual(structure);
    const expected = await capturePaint(page, clip, '#native-import-reference');
    await test.info().attach('native-source-black', { body: expected[0], contentType: 'image/png' });
    await test.info().attach('native-source-white', { body: expected[1], contentType: 'image/png' });
    const reference = await decoded(page, expected);
    expect(occupied(actual)).toBeDefined();
    expect(occupied(reference)).toBeDefined();
    expectSamePaint(actual, reference);
    if (capture.controls) await preservationControls(page, clip, reference, structure);
  } finally {
    await page.locator('#native-import-frame').evaluate((e) => e.remove());
  }
}
async function preservationControls(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  reference: Awaited<ReturnType<typeof decoded>>,
  structure: unknown,
): Promise<void> {
  const frame = page.locator('#native-import-frame');
  await frame.evaluate((e) => ((e as SVGElement).style.left = '1px'));
  await expect.poll(() => frame.boundingBox()).toEqual({ ...clip, x: 1 });
  const shifted = await decoded(page, await capturePaint(page, clip, '#native-import-reference'));
  await frame.evaluate((e) => ((e as SVGElement).style.left = '0px'));
  expect(occupied(shifted)).not.toEqual(occupied(reference));
  const circle = page.locator('#native-import-reference circle').first();
  await circle.evaluate((e) => e.setAttribute('transform', 'translate(0.0234375 0)'));
  expect(await paintStructure(page, '#native-import-reference > svg')).not.toEqual(structure);
  const interior = await decoded(page, await capturePaint(page, clip, '#native-import-reference'));
  expect(occupied(interior)).toEqual(occupied(reference));
  await circle.evaluate((e) => e.removeAttribute('transform'));
  await page.locator('#native-import-reference > svg').evaluate((e) => e.setAttribute('stroke-width', '3'));
  const thicker = await decoded(page, await capturePaint(page, clip, '#native-import-reference'));
  expect(Math.max(diffPct(reference[0], thicker[0]), diffPct(reference[1], thicker[1]))).toBeGreaterThan(PARITY_MAX_DIFF_PCT);
}
