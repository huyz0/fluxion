import { readFileSync } from 'node:fs';
import { EditorPage } from './pages/editor.js';
import { type Pixels, pixels } from './pages/image-diff.js';
import { expect, test } from './test.js';

type Hooks = {
  registerShape(value: unknown): string | undefined;
  records(): Record<string, Record<string, unknown>>;
  applyRecords(puts: readonly object[]): string | undefined;
};
const sample = (image: Pixels, x: number, y: number) => [
  ...image.data.slice((Math.floor(y) * image.w + Math.floor(x)) * 4, (Math.floor(y) * image.w + Math.floor(x)) * 4 + 4),
];
for (const origin of [0, 20]) {
  test(`FR-LIB-004: actual artwork wrapper clips overflow at viewport origin ${origin}, with live nonvacuity control`, async ({ page, blocked }, info) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => Object.assign(window, { __FLUXION_TEST_HOOKS__: true }));
    const editor = new EditorPage(page);
    await editor.open('new');
    const definition = JSON.parse(readFileSync('fixtures/artwork/paint.shape.json', 'utf8'));
    definition.artwork = {
      viewBox: { x: origin, y: origin, width: 100, height: 100 },
      root: {
        name: 'g',
        attributes: {},
        children: [{ name: 'rect', attributes: { x: String(origin + 80), y: String(origin + 20), width: '60', height: '60', fill: '#ff0000' }, children: [] }],
      },
    };
    expect(
      await page.evaluate((input) => {
        const hooks = (window as unknown as { __fluxion: Hooks }).__fluxion;
        const failure = hooks.registerShape(input);
        if (failure) return failure;
        const screen = Object.values(hooks.records()).find((r) => r['type'] === 'screen');
        return hooks.applyRecords([
          {
            id: 'ViewportTest001',
            type: 'element',
            kind: 'shape',
            screenId: screen?.['id'],
            index: 'a0',
            defId: 'test:artwork',
            transform: { x: 150, y: 150, w: 100, h: 100 },
          },
        ]);
      }, definition),
    ).toBeUndefined();
    await page.keyboard.press('F5');
    const screen = page.getByTestId('present-in-place').locator('.fx-screen');
    await expect.poll(() => screen.boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const artwork = page.getByTestId('present-in-place').locator('.fx-artwork');
    await expect(artwork).toHaveCount(1);
    expect(await artwork.evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden');
    await expect(artwork).toHaveAttribute('width', '100');
    await expect(artwork).toHaveAttribute('height', '100');
    const box = await artwork.evaluate((e) => {
      const r = e.closest('.fx-el')?.getBoundingClientRect();
      return r && { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(box).toEqual({ x: 150, y: 150, width: 100, height: 100 });
    const normal = await page.screenshot({ animations: 'disabled', scale: 'css' });
    const before = await pixels(page, normal);
    expect([before.w, before.h]).toEqual([1920, 1080]);
    expect(sample(before, 245, 200)).toEqual([255, 0, 0, 255]);
    expect(sample(before, 270, 200)).toEqual([255, 255, 255, 255]);
    await artwork.evaluate((e) => ((e as SVGElement).style.overflow = 'visible'));
    const exposed = await page.screenshot({ animations: 'disabled', scale: 'css' });
    const after = await pixels(page, exposed);
    expect(sample(after, 270, 200)).toEqual([255, 0, 0, 255]);
    await artwork.evaluate((e) => (e as SVGElement).style.removeProperty('overflow'));
    expect(sample(await pixels(page, await page.screenshot({ animations: 'disabled', scale: 'css' })), 270, 200)).toEqual([255, 255, 255, 255]);
    await info.attach('live-clipped', { body: normal, contentType: 'image/png' });
    await info.attach('negative-control-visible', { body: exposed, contentType: 'image/png' });
    expect(blocked).toEqual([]);
  });
}
