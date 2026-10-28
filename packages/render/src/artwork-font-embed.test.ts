// FR-LIB-004 FR-AST-003: a static page draws saved artwork text only in its exact retained bytes, embedded under a private alias
// (ADR-0192, M18.116).
import {
  allowsShapePackContentLicense,
  artworkFontAlias,
  createRegistry,
  parseVersionedShapePackSubset,
  type ShapeDef,
  sha256Hex,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { artworkFontFaceCss, embedSavedShapePacks } from './artwork-font-embed.js';
import { builtinRegistries } from './builtins.js';
import { renderDocumentToHtml } from './ssr.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw' | '?inline'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = Object.values(import.meta.glob('../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true }))[0];
const inline =
  Object.values(import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true }))[0] ??
  '';
const BASE64 = inline.slice(inline.indexOf(',') + 1);
const INTER = Uint8Array.from(atob(BASE64), (c) => c.charCodeAt(0));
const SHA = '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc';
const ALIAS = artworkFontAlias(SHA);
const policy = allowsShapePackContentLicense;
const sha256 = async (bytes: Uint8Array) => sha256Hex(bytes);
function packs(): readonly VersionedShapePackSubset[] {
  const parsed = parseVersionedShapePackSubset(JSON.parse(json ?? 'null'), policy);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return [parsed.value];
}
const shapes = () => createRegistry<string, ShapeDef>('shapeDefs');

describe('embedSavedShapePacks (M18.116)', () => {
  it('FR-AST-003: registers geometry and bindings, and the page embeds the exact bytes once under the alias', async () => {
    const target = shapes();
    const embedded = await embedSavedShapePacks(target, packs(), { bytesOf: () => INTER, policy, sha256 });
    if (!embedded.ok) throw new Error(JSON.stringify(embedded.error));
    expect(embedded.value.fonts.map((f) => [f.alias, f.weight, f.style, f.bytes.length])).toEqual([[ALIAS, 400, 'normal', 23664]]);
    const b = documentBuilder();
    b.rect(b.screen(), { defId: 'sample:label' });
    const { html } = renderDocumentToHtml(b.build(), {
      registries: builtinRegistries(target, undefined, undefined, embedded.value.artworkFonts),
      artworkFonts: embedded.value.fonts,
    });
    expect(html.split('@font-face').length - 1).toBe(1);
    expect(html).toContain(`@font-face { font-family: "${ALIAS}"; src: url(data:font/woff2;base64,${BASE64}) format("woff2"); font-weight: 400;`);
    const text = /<text[^>]*>API<\/text>/.exec(html)?.[0] ?? '';
    expect(text).toContain(`font-family="${ALIAS}"`);
    expect(text).not.toContain('Inter');
    expect(embedded.value.artworkFonts.get('sample:label')?.map((b) => b.alias)).toEqual([ALIAS]);
    embedded.value.dispose();
    expect([target.list(), embedded.value.artworkFonts.list()]).toEqual([[], []]);
  });

  it('FR-LIB-004: refuses missing, resized and changed bytes, leaving no definition or binding', async () => {
    const changed = INTER.slice();
    changed[100] = (changed[100] ?? 0) ^ 1;
    for (const bytes of [undefined, INTER.subarray(1), changed]) {
      const target = shapes();
      const refused = await embedSavedShapePacks(target, packs(), { bytesOf: () => bytes, policy, sha256 });
      expect(refused.ok ? '' : refused.error[0]?.message).toMatch(/^artwork font 8909904a/);
      expect(target.list()).toEqual([]);
    }
  });

  it('FR-LIB-004: checks the packs before reading any font', async () => {
    let reads = 0;
    const refused = await embedSavedShapePacks(shapes(), packs(), {
      bytesOf: () => {
        reads++;
        return INTER;
      },
      policy: () => false,
      sha256,
    });
    expect([refused.ok, reads]).toEqual([false, 0]);
  });

  it('NFR-SEC-001: the @font-face rules come from aliases and bytes only', () => {
    expect(() => artworkFontFaceCss([{ alias: 'Inter"; } body { color: red', weight: 400, style: 'normal', bytes: INTER }])).toThrow();
    expect(() => artworkFontFaceCss([{ alias: ALIAS, weight: 400.5, style: 'normal', bytes: INTER }])).toThrow();
    expect(artworkFontFaceCss([])).toBe('');
  });
});
