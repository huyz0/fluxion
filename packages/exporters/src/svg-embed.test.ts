import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMetricsMeasurer, createRegistry, readFontMetrics, type ShapeDef, sha256Hex } from '@fluxion/core';
import { type FontSubsetInput, type FontSubsetOutcome, instantiateFontEngines, subsetFont, type WasmInstantiate } from '@fluxion/format';
import { builtinRegistries, createFixedMeasurer } from '@fluxion/render';
import type { DocumentFile } from '@fluxion/schema';
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
const RIGHTS = readFileSync(at('fixtures/fonts/LICENSE-Roboto-OFL.txt'), 'utf8');
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
const engines = () => instantiateFontEngines(MODULES, { sha256, instantiate });

/** Roboto 400, verified, with a subset job run on this thread; the jobs it was given are kept. */
function roboto(subset?: (input: FontSubsetInput) => Promise<FontSubsetOutcome>): SvgFontPorts & { readonly jobs: FontSubsetInput[] } {
  const jobs: FontSubsetInput[] = [];
  const run = subset ?? (async (input: FontSubsetInput) => subsetFont(input, await engines(), { sha256 }));
  return {
    faces: [{ family: 'Roboto', weight: 400, style: 'normal', bytes: ROBOTO, rights: RIGHTS, verifiedSource: true }],
    codec: async () => (await engines()).codec,
    subset: (input) => {
      jobs.push(input);
      return run(input);
    },
    jobs,
  };
}

/** A screen of two rects labelled `first` and `second` in `family`. */
function labelled(first: string, second: string, family = 'Roboto'): DocumentFile {
  const b = documentBuilder({ title: 'Embed', seed: 2046 });
  const s = b.screen({ size: { w: 400, h: 300 } });
  const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const style = { font: { family, size: 20 } } as never;
  const a = b.rect(s, { x: 20, y: 20, w: 360, h: 80, style });
  const c = b.rect(s, { x: 20, y: 150, w: 360, h: 80, style });
  const built = b.build();
  return {
    ...built,
    records: { ...built.records, [a]: { ...built.records[a], text: doc(first) }, [c]: { ...built.records[c], text: doc(second) } },
  } as DocumentFile;
}

/** The `@font-face` rules of `svg`: alias, data URL bytes, weight and style. */
const faces = (svg: string) =>
  [
    ...svg.matchAll(
      /@font-face\{font-family:"([^"]+)";src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\);font-weight:(\d+);font-style:(\w+)\}/g,
    ),
  ].map((m) => ({ alias: m[1] as string, bytes: Uint8Array.from(atob(m[2] as string), (c) => c.charCodeAt(0)), weight: m[3], style: m[4] }));

describe('exportSvg: embedded fonts (ADR-0056 item 5, M20.46)', () => {
  it("FR-EXP-004: fonts embed cuts each face to the export's codepoints with the host's font job, once, under an alias its text names first", async () => {
    const fonts = roboto();
    const { svg, diagnostics } = await exportSvg(labelled('Hello', 'world'), { package: false, fonts: 'embed' }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    expect(fonts.jobs.length).toBe(1);
    expect(String.fromCodePoint(...(fonts.jobs[0]?.codepoints ?? []))).toBe('Hdelorw');
    expect(fonts.jobs[0]).toMatchObject({ sourceSha256: sha256Hex(ROBOTO), weight: 400, style: 'normal', verifiedSource: true });
    const embedded = faces(svg);
    expect(embedded.length).toBe(1);
    const [face] = embedded as [(typeof embedded)[number]];
    expect(face.alias).toBe(`fx-export-${sha256Hex(face.bytes).slice(0, 12)}`);
    expect(face).toMatchObject({ weight: '400', style: 'normal' });
    expect(face.bytes.length).toBeLessThan(ROBOTO.length);
    // the sheet sits in <defs> before the drawing; both labels name the alias first, then their own family
    expect(svg.indexOf('<defs><style type="text/css">@font-face')).toBeLessThan(svg.indexOf('<g fluxion:el'));
    expect([...svg.matchAll(new RegExp(`font-family="&quot;${face.alias}&quot;, &quot;Roboto&quot;"`, 'g'))].length).toBe(2);
    expect(svg).toMatch(/>Hello<\/tspan>/);
    expect(svg).not.toMatch(/<path d="M[^"]+" transform="translate/);
    expect(diagnostics.filter((d) => d.code.startsWith('FLX_EXPORT_FONT'))).toEqual([]);
  });

  it('FR-EXP-004: a face whose subset is refused, or a host with no font job, embeds the whole file, reported FLX_EXPORT_FONT_WHOLE', async () => {
    const refused = roboto(async () => ({ status: 'kept', reason: 'unverified-source', message: 'the font source is not verified' }));
    const kept = await exportSvg(labelled('Hello', 'world'), { package: false, fonts: 'embed' }, { registries, measurer, fonts: refused });
    expect(svg11Problems(kept.svg)).toEqual([]);
    expect(faces(kept.svg).map((f) => f.bytes)).toEqual([ROBOTO]);
    expect(kept.diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_FONT_WHOLE', message: expect.stringContaining('not verified') }));
    const { subset: _, ...noJob } = roboto();
    const whole = await exportSvg(labelled('Hello', 'world'), { package: false, fonts: 'embed' }, { registries, measurer, fonts: noJob });
    expect(faces(whole.svg).map((f) => f.bytes)).toEqual([ROBOTO]);
    expect(whole.diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_FONT_WHOLE', message: expect.stringContaining('no font job') }));
  });

  it('FR-EXP-004: a whole TrueType face embeds as font/ttf in format truetype (M20.46 r1 F1)', async () => {
    const fira = new Uint8Array(readFileSync(at('fixtures/fonts/fira-sans-400.ttf')));
    const fonts: SvgFontPorts = { faces: [{ family: 'Roboto', weight: 400, style: 'normal', bytes: fira }], codec: async () => (await engines()).codec };
    const { svg } = await exportSvg(labelled('Hello', 'world'), { package: false, fonts: 'embed' }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    const rule = /@font-face\{font-family:"(fx-export-[0-9a-f]{12})";src:url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\) format\("truetype"\);/.exec(svg);
    expect(rule?.[1]).toBe(`fx-export-${sha256Hex(fira).slice(0, 12)}`);
    expect(Uint8Array.from(atob(rule?.[2] as string), (c) => c.charCodeAt(0))).toEqual(fira);
  });

  it("FR-EXP-004: a run in another face of the family names that face's own alias, each face embedded once (M20.46 r1 F2)", async () => {
    const bold = new Uint8Array(readFileSync(at('fixtures/fonts/roboto-700.woff2')));
    const base = roboto();
    const fonts = {
      ...base,
      faces: [...base.faces, { family: 'Roboto', weight: 700, style: 'normal' as const, bytes: bold, rights: RIGHTS, verifiedSource: true }],
    };
    const file = labelled('Hello', 'world');
    const [first] = Object.values(file.records).filter((r) => (r as { text?: unknown }).text !== undefined) as unknown as [{ id: string }];
    const strong = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'text', text: 'there', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    const records = { ...file.records, [first.id]: { ...file.records[first.id as never], text: strong } };
    const { svg } = await exportSvg({ ...file, records } as DocumentFile, { package: false, fonts: 'embed' }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    const rules = [...svg.matchAll(/@font-face\{font-family:"(fx-export-[0-9a-f]{12})";[^}]*font-weight:(\d+)/g)].map((m) => ({ alias: m[1], weight: m[2] }));
    expect(rules.map((r) => r.weight).sort()).toEqual(['400', '700']);
    const heavy = rules.find((r) => r.weight === '700')?.alias as string;
    expect(svg).toMatch(new RegExp(`<tspan x="[\\d.]+" font-family="&quot;${heavy}&quot;, &quot;Roboto&quot;" font-weight="700">there</tspan>`));
    expect(fonts.jobs.map((j) => j.weight).sort()).toEqual([400, 700]);
  });

  it('FR-EXP-004: an embedded export with a font no face matches names its family alone, reported FLX_EXPORT_FONT_NOT_EMBEDDED', async () => {
    const fonts = roboto();
    const { svg, diagnostics } = await exportSvg(labelled('Hello', 'world', 'Georgia'), { package: false, fonts: 'embed' }, { registries, measurer, fonts });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).not.toContain('<style');
    expect(svg).toMatch(/font-family="&quot;Georgia&quot;"/);
    expect(fonts.jobs).toEqual([]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: expect.stringContaining('Georgia') }));
  });
});
