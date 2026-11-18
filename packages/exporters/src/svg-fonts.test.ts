import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createMetricsMeasurer, createRegistry, readFontMetrics, type ShapeDef } from '@fluxion/core';
import { instantiateFontEngines, type WasmInstantiate, type Woff2CodecExports } from '@fluxion/format';
import { builtinRegistries, createFixedMeasurer } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';
import type { SvgFontPorts } from './svg-fonts.js';
import { svg11Problems } from './svg11.js';

const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } }, 'test');
const registries = builtinRegistries(shapeDefs);
const at = (path: string) => new URL(`../../../${path}`, import.meta.url);
const ROBOTO = new Uint8Array(readFileSync(at('fixtures/fonts/roboto-400.woff2')));
const measurer = createMetricsMeasurer(
  readFontMetrics(JSON.parse(readFileSync(at('fixtures/fonts/roboto.metrics.json'), 'utf8'))).faces,
  createFixedMeasurer(),
);
const ENGINE = at('packages/format/assets/font-engine/');
const MODULES = {
  harfbuzz: new Uint8Array(readFileSync(new URL('harfbuzz-subset.wasm', ENGINE))),
  codec: new Uint8Array(readFileSync(new URL('woff2-codec.wasm', ENGINE))),
};
const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const instantiate: WasmInstantiate = async (bytes, imports) => (await WebAssembly.instantiate(bytes as BufferSource, imports as WebAssembly.Imports)).instance;

/** The faces port over Roboto 400, counting how often the codec is asked for. */
function roboto(): SvgFontPorts & { readonly asked: () => number } {
  let asked = 0;
  const codec = async (): Promise<Woff2CodecExports> => {
    asked += 1;
    return (await instantiateFontEngines(MODULES, { sha256, instantiate })).codec;
  };
  return { faces: [{ family: 'Roboto', weight: 400, style: 'normal', bytes: ROBOTO }], codec, asked: () => asked };
}

/** A screen of one rect labelled `doc` in `family`. */
function labelled(doc: unknown, family = 'Roboto'): { file: DocumentFile; id: RecordId } {
  const b = documentBuilder({ title: 'Fonts', seed: 2013 });
  const s = b.screen({ size: { w: 400, h: 200 } });
  const id = b.rect(s, { x: 20, y: 20, w: 360, h: 80, style: { font: { family, size: 20 } } as never });
  const built = b.build();
  const records = { ...built.records, [id]: { ...built.records[id], text: doc } };
  return { file: { ...built, records } as DocumentFile, id };
}

const para = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks === undefined ? {} : { marks }) });
const numbers = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe('exportSvg: fonts (ADR-0056 item 5, M20.13)', () => {
  it("FR-EXP-004: text is outlined by default from the face its font matches, each piece's path at its tspan's x and baseline, its text in the title", async () => {
    const { file } = labelled(para(text('Hello office')));
    const plain = await exportSvg(file, { package: false }, { registries, measurer });
    const tspan =
      /<tspan x="([\d.]+)" y="([\d.]+)">Hello office<\/tspan>/.exec(plain.svg) ?? /<tspan x="[\d.]+" y="([\d.]+)"><tspan x="([\d.]+)">/.exec(plain.svg);
    expect(tspan).not.toBeNull();
    const fonts = roboto();
    const { svg, diagnostics } = await exportSvg(file, { package: false }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).not.toContain('<text');
    expect(svg).toMatch(/<title>Hello office<\/title>/);
    const path = /<path d="(M[^"]+)" transform="translate\(([\d.]+) ([\d.]+)\)"/.exec(svg);
    const line = /<tspan x="[\d.]+" y="([\d.]+)"><tspan x="([\d.]+)">Hello office<\/tspan>/.exec(plain.svg);
    expect([path?.[2], path?.[3]]).toEqual([line?.[2], line?.[1]]);
    // the glyphs (ligated "ffi" included) span the measured width, the pen's last advance at most past the ink
    const xs = numbers(path?.[1] as string).filter((_, i) => i % 2 === 0);
    const width = measurer.measure('Hello office', { family: 'Roboto', size: 20, weight: 400, style: 'normal' }).width;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(width);
    expect(Math.max(...xs)).toBeGreaterThan(width - 3);
    expect(diagnostics.filter((d) => d.code.startsWith('FLX_EXPORT_FONT'))).toEqual([]);
    expect(fonts.asked()).toBe(1);
  });

  it('FR-EXP-004: an outlined piece keeps its marks: a colour as its fill, underline and strike as bars, a link around it', async () => {
    const { file } = labelled(
      para(
        text('red', [{ type: 'color', attrs: { color: '#ff0000' } }]),
        text(' under', [{ type: 'underline' }, { type: 'strike' }]),
        text(' out', [{ type: 'link', attrs: { href: 'https://example.com/' } }]),
      ),
    );
    const { svg } = await exportSvg(file, { package: false }, { registries, measurer, fonts: roboto() });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).not.toContain('<text');
    expect(svg).toMatch(/<g fill="#ff0000"><path d="M/);
    // underline and strike: two bars after the piece's path, in its (inherited) fill
    expect(svg).toMatch(/<g><path d="M[^"]+" transform="translate\([^)]+\)"><\/path><rect [^>]+><\/rect><rect [^>]+><\/rect><\/g>/);
    expect(svg).toMatch(/<a xlink:href="https:\/\/example.com\/"><g fill="#0000ee"><path d="M[^"]+" transform="[^"]+"><\/path><rect /);
  });

  it('FR-EXP-004: a font no face matches stays <text> naming its family, reported FLX_EXPORT_FONT_NOT_EMBEDDED; the rest is outlined', async () => {
    const { file } = labelled(para(text('serif'), text(' sans', [{ type: 'font', attrs: { family: 'Roboto' } }])), 'Georgia');
    const fonts = roboto();
    const { svg, diagnostics } = await exportSvg(file, { package: false }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).toMatch(/<text [^>]*font-family="&quot;Georgia&quot;"[^>]*>.*>serif<\/tspan><\/tspan><\/text>/);
    expect(svg).not.toMatch(/<tspan[^>]*> sans<\/tspan>/);
    expect(svg).toMatch(/<title>serif sans<\/title>/);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: expect.stringContaining('Georgia') }));
    // with no faces lent at all, nothing is outlined and the codec is never needed
    const none = await exportSvg(file, { package: false }, { registries, measurer });
    expect(none.svg).not.toContain('<title>serif');
    expect(none.diagnostics.filter((d) => d.code === 'FLX_EXPORT_FONT_NOT_EMBEDDED').length).toBe(2);
    const unread = await exportSvg(
      file,
      { package: false },
      { registries, measurer, fonts: { ...fonts, faces: [{ ...fonts.faces[0], bytes: new Uint8Array(8) } as never] } },
    );
    expect(unread.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: expect.stringContaining('cannot be read') }),
    );
  });

  it('FR-EXP-004: a face that fails while its runs are shaped (a damaged table fontkit reads lazily) stays <text>, reported, never thrown (M20.13 r1 F1)', async () => {
    const ttf = new Uint8Array(readFileSync(at('fixtures/fonts/fira-sans-400.ttf')));
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    // the table directory: numTables at 4, then 16-byte records of tag, checksum, offset and length
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + 16 * i;
      if (String.fromCharCode(...ttf.subarray(record, record + 4)) === 'loca')
        ttf.fill(0xff, view.getUint32(record + 8), view.getUint32(record + 8) + view.getUint32(record + 12));
    }
    const { file } = labelled(para(text('Hello office')));
    const fonts = { ...roboto(), faces: [{ family: 'Roboto', weight: 400, style: 'normal' as const, bytes: ttf }] };
    const { svg, diagnostics } = await exportSvg(file, { package: false }, { registries, measurer, fonts });
    expect(svg).toMatch(/<tspan x="[\d.]+">Hello office<\/tspan>/);
    expect(svg).not.toContain('<title>Hello office');
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: expect.stringContaining('cannot be read') }));
  });

  it('FR-EXP-004: a list marker is recorded and outlined too, ending 0.4 em before its line as the <text> marker does (M20.13 r1 F2)', async () => {
    const list = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('item')] }] }] }] };
    const { file } = labelled(list);
    const plain = await exportSvg(file, { package: false }, { registries, measurer });
    const end = Number(/<tspan x="([\d.]+)" text-anchor="end">\u2022<\/tspan>/.exec(plain.svg)?.[1]);
    expect(Number.isFinite(end)).toBe(true);
    const { svg } = await exportSvg(file, { package: false }, { registries, measurer, fonts: roboto() });
    expect(svg).not.toContain('<text');
    const bullet = measurer.measure('\u2022', { family: 'Roboto', size: 20, weight: 400, style: 'normal' }).width;
    const placed = [...svg.matchAll(/<path d="M[^"]+" transform="translate\(([\d.]+) ([\d.]+)\)"/g)].map((m) => Number(m[1]));
    // the marker's path first, then the item's
    expect(placed.length).toBe(2);
    expect(placed[0]).toBeCloseTo(end - bullet, 2);
    expect(placed[1]).toBeGreaterThan(end);
  });

  it('FR-EXP-004: fontkit is imported only when an export outlines, and nothing it loads in a browser evaluates strings (studio CSP)', () => {
    const source = readFileSync(new URL('./svg-fonts.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import (?!type )[^;]*from 'fontkit'/m);
    expect(source).toContain("await import('fontkit')");
    // every module fontkit's browser build reaches, by its static and dynamic imports and requires
    const require = createRequire(import.meta.url);
    const entry = require.resolve('fontkit').replace(/main\.cjs$/, 'browser-module.mjs');
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      const from = createRequire(file);
      for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([@\w][\w@./-]*|\.\.?\/[\w@./-]*)["']/g))
        walk(from.resolve(m[1] as string));
    };
    walk(entry);
    expect(seen.size).toBeGreaterThan(10);
    const evaluating = [...seen].filter((file) => /\bnew Function\b|[^.\w]Function\(|\beval\(/.test(readFileSync(file, 'utf8')));
    expect(evaluating).toEqual([]);
  });
});
