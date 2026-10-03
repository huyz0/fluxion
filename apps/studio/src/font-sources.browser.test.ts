import { createCore } from '@fluxion/core';
import { createAssetStore } from '@fluxion/editor';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { bundledFamilies, fontSources } from './font-sources.js';
import type { Fetch } from './google-fonts.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const ROBOTO = import.meta.glob('../../../fixtures/fonts/roboto-400.woff2', { query: '?url', import: 'default', eager: true });
const roboto = async () => new Uint8Array(await (await fetch(Object.values(ROBOTO)[0] as string)).arrayBuffer());

function setup(http?: Fetch) {
  const b = documentBuilder({ seed: 21 });
  b.screen();
  const core = createCore(b.build());
  return { core, sources: fontSources(core, createAssetStore(), seededRandom(9021), http) };
}

describe("the studio's font sources (FR-THM-008, M9.17)", () => {
  it("FR-THM-008: the bundled families are the pack's three, once each", () => {
    expect(bundledFamilies()).toEqual(['Inter', 'Source Serif 4', 'JetBrains Mono']);
    expect(setup().sources.bundled).toEqual(bundledFamilies());
  });

  it('FR-THM-008: the catalog lists families with their category, and a family that is not in it is refused', async () => {
    const { sources } = setup();
    const catalog = (await sources.catalog?.()) ?? [];
    expect(catalog.length).toBeGreaterThan(1000);
    expect(catalog.find((c) => c.family === 'Lora')).toMatchObject({ category: 'serif' });
    expect(await sources.addGoogle?.('No Such Family')).toEqual({ ok: false, message: 'No Such Family is not in the catalog' });
  });

  it('FR-THM-008: adding a Google family asks for regular and bold, upright and italic, and an upload names its family from the file', async () => {
    const asked: string[] = [];
    const bytes = await roboto();
    const http: Fetch = async (url) => {
      asked.push(url);
      const sheet = url.startsWith('https://fonts.googleapis.com/')
        ? ['normal', 'italic']
            .flatMap((style) =>
              [400, 700].map(
                (w) =>
                  `/* latin */\n@font-face {\n font-family: 'Lora';\n font-style: ${style};\n font-weight: ${w};\n src: url(https://fonts.gstatic.com/s/lora/v1/${style}${w}.woff2) format('woff2');\n unicode-range: U+0000-00FF;\n}`,
              ),
            )
            .join('\n')
        : '';
      return { ok: true, status: 200, text: async () => sheet, arrayBuffer: async () => bytes.slice().buffer };
    };
    const { core, sources } = setup(http);
    expect(await sources.addGoogle?.('Lora')).toEqual({ ok: true, family: 'Lora' });
    expect(asked[0]).toContain('family=Lora:ital,wght@0,400;0,700;1,400;1,700');
    expect(core.store.members('byType', 'asset')).toHaveLength(4);
    const uploaded = await sources.upload({ name: 'Fx_Mine-Bold.woff2', bytes });
    expect(uploaded).toEqual({ ok: true, family: 'Fx Mine' });
    const refused = await sources.upload({ name: 'photo.woff2', bytes: Uint8Array.from([71, 73, 70, 56]) });
    expect(refused.ok).toBe(false);
  }, 180_000);
});
