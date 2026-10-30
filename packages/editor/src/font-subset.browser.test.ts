import { glyphInventory, instantiateFontEngines, subsetFont, type WasmInstantiate } from '@fluxion/format';
import { describe, expect, it } from 'vitest';

// Rendered and shaped parity of a used-glyph subset with its source in Chromium (FR-AST-003, ADR-0051): the same
// strings drawn with the original TTF and with the subset WOFF2 give the same advances and the same pixels.
const url = (glob: Record<string, string>): string => Object.values(glob)[0] ?? '';
const FIRA = url(import.meta.glob('../../../fixtures/fonts/fira-sans-400.ttf', { query: '?url', import: 'default', eager: true }));
const HARFBUZZ = url(import.meta.glob('../../format/assets/font-engine/harfbuzz-subset.wasm', { query: '?url', import: 'default', eager: true }));
const CODEC = url(import.meta.glob('../../format/assets/font-engine/woff2-codec.wasm', { query: '?url', import: 'default', eager: true }));
const instantiate: WasmInstantiate = async (bytes, imports) => (await WebAssembly.instantiate(bytes as BufferSource, imports as WebAssembly.Imports)).instance;
const bytesOf = async (from: string) => new Uint8Array(await (await fetch(from)).arrayBuffer());
const sha256 = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)), (b) => b.toString(16).padStart(2, '0')).join('');

// ligatures (fi, ffi, fl), a combining mark after its base, precomposed accents, and a supplementary character the
// font lacks (drawn by the fallback in both cases)
const SAMPLES = ['office affine flow', 'é ä Ångström', 'Hamburgefonstiv 0123', 'x\u{1d400}y'];

async function face(family: string, bytes: Uint8Array): Promise<void> {
  const loaded = await new FontFace(family, bytes.slice().buffer).load();
  document.fonts.add(loaded);
}

/** The width of `text` laid out by the browser's shaper in `family`, with or without ligatures. */
function width(text: string, family: string, ligatures = 'normal'): number {
  const span = document.createElement('span');
  span.style.cssText = `font: 40px "${family}", monospace; white-space: pre; font-variant-ligatures: ${ligatures}; position: absolute`;
  span.textContent = text;
  document.body.append(span);
  const w = span.getBoundingClientRect().width;
  span.remove();
  return w;
}

/** The pixels of `text` drawn in `family`. */
function pixels(text: string, family: string): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(900, 80);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.font = `40px "${family}", monospace`;
  ctx.fillText(text, 10, 55);
  return ctx.getImageData(0, 0, 900, 80).data;
}

describe('subset rendering parity (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: a subset shapes and renders its inventory exactly like the source font', async () => {
    const source = await bytesOf(FIRA);
    const engines = await instantiateFontEngines({ harfbuzz: await bytesOf(HARFBUZZ), codec: await bytesOf(CODEC) }, { sha256, instantiate });
    const doc = {
      schemaVersion: '1.7',
      records: {
        e1: {
          id: 'e1',
          type: 'element',
          kind: 'text',
          text: { type: 'doc', content: SAMPLES.map((s) => ({ type: 'paragraph', content: [{ type: 'text', text: s }] })) },
        },
      },
    } as unknown as Parameters<typeof glyphInventory>[0];
    const inventory = glyphInventory(doc);
    if (inventory.status !== 'complete') throw new Error(inventory.reason);
    const { codepoints } = inventory;
    const outcome = await subsetFont(
      { bytes: source, sourceSha256: await sha256(source), weight: 400, style: 'normal', codepoints, verifiedSource: true },
      engines,
      { sha256 },
    );
    if (outcome.status !== 'subset') throw new Error(`kept: ${outcome.reason}`);
    expect(outcome.woff2.length).toBeLessThan(source.length / 10);
    await face('Fira Source', source);
    await face('Fira Subset', outcome.woff2);
    // the ligature case is real: the source font shapes "office" differently without ligatures
    expect(width(SAMPLES[0] as string, 'Fira Source', 'none')).not.toBe(width(SAMPLES[0] as string, 'Fira Source'));
    for (const text of SAMPLES) {
      expect(width(text, 'Fira Subset'), text).toBe(width(text, 'Fira Source'));
      expect(width(text, 'Fira Subset', 'none'), text).toBe(width(text, 'Fira Source', 'none'));
      const [subset, original] = [pixels(text, 'Fira Subset'), pixels(text, 'Fira Source')];
      expect(subset.some((v) => v !== 0)).toBe(true);
      expect(
        subset.every((v, i) => v === original[i]),
        text,
      ).toBe(true);
    }
  });
});
