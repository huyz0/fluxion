import { readFileSync } from 'node:fs';
import { createRegistry, type ShapeDef, sha256Hex, type TextMeasurer } from '@fluxion/core';
import { loadFlux } from '@fluxion/format';
import { builtinRegistries, createFixedMeasurer } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';
import { svg11Problems } from './svg11.js';

const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } }, 'test');
const q = 'min(r, w/2, h/2)';
shapeDefs.register(
  'basic:rounded-rect',
  {
    id: 'basic:rounded-rect',
    params: { r: { type: 'number', min: 0, max: 1000, default: 12 } },
    outline: {
      path: `M {${q}} 0 H {w - ${q}} A {${q}} {${q}} 0 0 1 {w} {${q}} V {h - ${q}} A {${q}} {${q}} 0 0 1 {w - ${q}} {h} H {${q}} A {${q}} {${q}} 0 0 1 0 {h - ${q}} V {${q}} A {${q}} {${q}} 0 0 1 {${q}} 0 Z`,
    },
    defaultSize: { w: 160, h: 100 },
  },
  'test',
);
const registries = builtinRegistries(shapeDefs);
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };

const read = (path: string): DocumentFile => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const FIXTURES = ['minimal', 'two-rects-line', 'unknown-kind', 'rich-text'].map((n) => ({ name: n, file: read(`fixtures/docs/${n}.flux.json`) }));
const MASTERED = { file: read('examples/masters-tables.flux.json'), screenId: '6UTNKFTvIaU4KrF97QOw2P' as RecordId };

/** The package bytes and the digest `svg`'s `<metadata>` carries. */
function carried(svg: string): { readonly bytes: Uint8Array; readonly sha256: string } {
  const m = /<fluxion:package [^>]*sha256="([0-9a-f]{64})"[^>]*>([A-Za-z0-9+/=]+)<\/fluxion:package>/.exec(svg);
  if (m === null) throw new Error('no package');
  return { bytes: Uint8Array.from(atob(m[2] as string), (c) => c.charCodeAt(0)), sha256: m[1] as string };
}

/** The text of each line `<tspan x y>` in `svg`, its pieces joined. */
const lines = (svg: string): string[] =>
  [...svg.matchAll(/<tspan x="[^"]+" y="[^"]+">((?:<a [^>]*>|<\/a>|<tspan[^>]*>[^<]*<\/tspan>)*)<\/tspan>/g)].map((m) =>
    [...(m[1] as string).matchAll(/>([^<]*)</g)].map((p) => p[1]).join(''),
  );

describe('exportSvg (ADR-0056, M20.12)', () => {
  it('FR-EXP-004: an exported fixture is valid SVG 1.1', async () => {
    for (const { name, file } of FIXTURES) {
      const out = await exportSvg(file, {}, { registries });
      expect(svg11Problems(out.svg), name).toEqual([]);
      await expect(out.svg).toMatchFileSnapshot(`../__golden__/${name}.svg`);
      // deterministic: the same input exports the same bytes
      expect((await exportSvg(file, {}, { registries })).svg).toBe(out.svg);
    }
    const mastered = await exportSvg(MASTERED.file, { screenId: MASTERED.screenId }, { registries });
    expect(svg11Problems(mastered.svg)).toEqual([]);
    // every element of the mastered screen has a view here: no placeholder stands in for one
    expect(mastered.diagnostics.filter((d) => d.code === 'FLX_EXPORT_NO_SVG_VIEW').map((d) => d.message.split(' ')[0])).toEqual([]);
    expect(mastered.svg).toContain('fluxion:master="01juEngAtRB8wyUaaRvkVH"');
    await expect(mastered.svg).toMatchFileSnapshot('../__golden__/masters-tables.svg');
    // what is not drawn is reported, never silently dropped
    const unknown = await exportSvg(FIXTURES[2]?.file as DocumentFile, {}, { registries });
    expect(unknown.diagnostics.map((d) => d.code)).toContain('FLX_EXPORT_NO_SVG_VIEW');
  });

  it('FR-EXP-004: a translucent connector draws its label at its opacity once, as present mode does', async () => {
    const file = structuredClone(FIXTURES[1]?.file as DocumentFile) as DocumentFile & { records: Record<string, Record<string, unknown>> };
    const connector = file.records['cWB8Ucz36bNpnt8N'] as Record<string, unknown>;
    connector['style'] = { opacity: 0.5 };
    connector['labels'] = [{ position: 0.5, text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'calls' }] }] } }];
    const { svg } = await exportSvg(file, { package: false }, { registries });
    const group = /<g fluxion:el="cWB8Ucz36bNpnt8N"[^>]*>(?:<title>[^<]*<\/title>)?<g opacity="([^"]+)">(.*?)<\/g><\/g>/.exec(svg);
    expect(group?.[1]).toBe('0.5');
    expect(group?.[2]).toContain('calls');
    expect(group?.[2]).not.toMatch(/<text[^>]* opacity=/);
  });

  it('FR-EXP-004: the checker refuses what an SVG 1.1 export must not hold', () => {
    const ok = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"><rect id="a" fill="#fff"/></svg>';
    expect(svg11Problems(ok)).toEqual([]);
    const bad = (body: string) => svg11Problems(`<svg version="1.1" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
    expect(bad('<foreignObject/>')).not.toEqual([]);
    expect(bad('<rect fill="var(--fx-a)"/>')).not.toEqual([]);
    expect(bad('<rect onclick="x()"/>')).not.toEqual([]);
    expect(bad('<image xlink:href="https://example.com/a.png"/>')).not.toEqual([]);
    expect(bad('<rect fill="url(#missing)"/>')).not.toEqual([]);
    expect(bad('<rect id="a"/><rect id="a"/>')).not.toEqual([]);
    expect(bad('<script/>')).not.toEqual([]);
    // a link may point outside the file only as an <a>'s own web or mail address (M20.43, cp5 F1)
    expect(bad('<a xlink:href="https://example.com/"><text>x</text></a>')).toEqual([]);
    expect(bad('<a xlink:href="javascript:alert(1)"><text>x</text></a>')).not.toEqual([]);
    expect(bad('<a xlink:href="https://example.com/"><image xlink:href="https://example.com/a.png"/></a>')).not.toEqual([]);
  });

  it('FR-EXP-004: text is measured tspans with no foreignObject', async () => {
    const file = FIXTURES[3]?.file as DocumentFile;
    const narrow = await exportSvg(file, { package: false }, { registries });
    expect(narrow.svg).not.toContain('foreignObject');
    expect(narrow.svg).toContain('<text ');
    // the lines come from the host's measurer: wider glyphs break the same text onto more lines, and no character is lost
    const fixed = createFixedMeasurer();
    const wide: TextMeasurer = { measure: (text, font) => ({ ...fixed.measure(text, font), width: fixed.measure(text, font).width * 2 }) };
    const wider = await exportSvg(file, { package: false }, { registries, measurer: wide });
    expect(lines(wider.svg).length).toBeGreaterThan(lines(narrow.svg).length);
    const chars = (s: string[]) => s.join('').replace(/\s/g, '');
    expect(chars(lines(wider.svg))).toBe(chars(lines(narrow.svg)));
  });

  it('FR-EXP-004: the package is in metadata', async () => {
    const out = await exportSvg(MASTERED.file, { screenId: MASTERED.screenId }, { registries });
    expect(out.svg.indexOf('<metadata>')).toBeLessThan(out.svg.indexOf('<rect'));
    const { bytes, sha256 } = carried(out.svg);
    expect(sha256Hex(bytes)).toBe(sha256);
    const loaded = await loadFlux(bytes, { hasher });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const records = Object.values(loaded.value.document.records);
    // the screen and its master, and nothing of any other screen
    expect(
      records
        .filter((r) => r.type === 'screen')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['01juEngAtRB8wyUaaRvkVH', MASTERED.screenId].sort());
    const placed = new Set(records.filter((r) => r.type === 'element').map((r) => (r as { readonly screenId?: string }).screenId));
    expect([...placed].every((s) => s === MASTERED.screenId || s === '01juEngAtRB8wyUaaRvkVH')).toBe(true);
    // a deck's second screen carries that screen alone
    const deck = read('fixtures/docs/r1-mvp-deck.flux.json');
    const second = Object.values(deck.records).filter((r) => r.type === 'screen')[1]?.id as RecordId;
    const one = await loadFlux(carried((await exportSvg(deck, { screenId: second }, { registries })).svg).bytes, { hasher });
    if (!one.ok) throw new Error(JSON.stringify(one.error));
    expect(
      Object.values(one.value.document.records)
        .filter((r) => r.type === 'screen')
        .map((r) => r.id),
    ).toEqual([second]);
    expect((await exportSvg(MASTERED.file, { screenId: MASTERED.screenId, package: false }, { registries })).svg).not.toContain('<metadata>');
  });
});
