import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { malformedShapeFile, portableShapeFile } from './pages/portable-shapes.js';
import { expect, test } from './test.js';

type Variant = 'inline' | 'element';
async function openBuilt(page: Page, variant: Variant, bytes: Uint8Array): Promise<string | undefined> {
  await page.goto('about:blank');
  const file = variant === 'inline' ? 'player.inline.js' : 'fluxion-player.js';
  await page.addScriptTag({ content: readFileSync(`packages/player-inline/dist/${file}`, 'utf8') });
  return page.evaluate(
    async ({ kind, data }) => {
      const root = document.createElement(kind === 'inline' ? 'div' : 'fluxion-player');
      root.style.cssText = 'display:block;width:1280px;height:800px';
      document.body.append(root);
      const bytes = Uint8Array.from(data);
      if (kind === 'inline') {
        const api = (window as unknown as { Fluxion: { start(bytes: Uint8Array, root: HTMLElement): Promise<{ ok: boolean; message?: string }> } }).Fluxion;
        const result = await api.start(bytes, root);
        return result.ok ? undefined : result.message;
      }
      let message: string | undefined;
      root.addEventListener('fluxion-error', (event) => {
        message = (event as CustomEvent<{ message: string }>).detail.message;
      });
      await (root as HTMLElement & { load(bytes: Uint8Array): Promise<void> }).load(bytes);
      return message;
    },
    { kind: variant, data: [...bytes] },
  );
}

for (const variant of ['inline', 'element'] as const) {
  test(`FR-LIB-009 NFR-SEC-001: built ${variant} accepts saved geometry and rejects rehashed malicious artwork`, async ({ page, blocked }) => {
    expect(await openBuilt(page, variant, await portableShapeFile())).toBeUndefined();
    await expect(page.locator('.fx-artwork')).toHaveCount(1);
    expect(await openBuilt(page, variant, await malformedShapeFile())).toContain('shape entry failed validation');
    await expect(page.locator('.fx-artwork')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __unsafe?: boolean }).__unsafe)).toBeUndefined();
    expect(blocked).toEqual([]);
  });
}
