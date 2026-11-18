import { readFileSync } from 'node:fs';
import { createRegistry, type ShapeDef, type TextMeasurer } from '@fluxion/core';
import { builtinRegistries } from '@fluxion/render';
import type { DocumentFile, RecordId, RichTextDoc } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';
import { svg11Problems } from './svg11.js';

const RECT = 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z';
const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: RECT }, defaultSize: { w: 160, h: 100 } }, 'test');
shapeDefs.register('basic:rounded-rect', { id: 'basic:rounded-rect', outline: { path: RECT }, defaultSize: { w: 160, h: 100 } }, 'test');
// a card: its label on top, a body region below, and an icon slot at its left
shapeDefs.register(
  'test:card',
  {
    id: 'test:card',
    outline: { path: RECT },
    defaultSize: { w: 200, h: 120 },
    textRegions: [
      { name: 'title', x: '0.3', y: '0', w: '0.7', h: '0.3' },
      { name: 'body', x: '0.3', y: '0.3', w: '0.7', h: '0.7' },
    ],
    iconSlots: [{ name: 'icon', x: '0', y: '0', w: '0.25', h: '0.25' }],
  },
  'test',
);
const registries = builtinRegistries(shapeDefs);
const read = (path: string): DocumentFile => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGGAMAEn0Av5S3fBPAAAAAElFTkSuQmCC';

/** Every character 10 px wide; ascent 8 and descent 2. */
const tens: TextMeasurer = {
  measure: (text, font) => ({ width: [...text].length * 10, height: (font.lineHeight ?? 1.2) * font.size, ascent: 8, descent: 2 }),
};

const doc = (...content: unknown[]): RichTextDoc => ({ type: 'doc', content }) as RichTextDoc;
const para = (attrs: object, ...content: unknown[]) => ({ type: 'paragraph', attrs, content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks === undefined ? {} : { marks }) });

describe('exportSvg: text marks, tables and regions (ADR-0056 item 3, M20.41)', () => {
  it('FR-EXP-004: marks draw as text-decoration, fills, highlight rectangles and links; list items have their markers', async () => {
    const { svg } = await exportSvg(read('fixtures/docs/rich-text.flux.json'), { package: false }, { registries });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).toMatch(/<tspan x="[^"]+" text-decoration="underline">underline ?<\/tspan>/);
    expect(svg).toMatch(/<tspan x="[^"]+" text-decoration="line-through">strike ?<\/tspan>/);
    expect(svg).toMatch(/<tspan x="[^"]+" fill="#[0-9a-fA-F]{3,8}">red ?<\/tspan>/);
    // the highlight is a rectangle behind its piece, drawn before the text
    const highlight = /<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="(#[0-9a-fA-F]{3,8})"><\/rect><\/g><text/.exec(svg);
    expect(highlight).not.toBeNull();
    // a link is underlined in the default link colour, as the html leaf's bare <a> is
    expect(svg).toMatch(/<a xlink:href="https:\/\/example\.com[^"]*"><tspan x="[^"]+" text-decoration="underline" fill="#0000ee">a link<\/tspan><\/a>/);
    // a bullet for each top-level item, a circle for a nested one, the number for an ordered one, each before its first line
    for (const marker of ['•', '◦', '3.']) expect(svg).toContain(`text-anchor="end">${marker}</tspan>`);
    expect(svg).not.toContain('<li');
  });

  it("FR-EXP-004: an in-document screen link draws as text, and a block's own alignment places its lines", async () => {
    const b = documentBuilder({ seed: 2041 });
    const s = b.screen({ size: { w: 400, h: 200 } });
    const right = b.text(s, 'x', { x: 0, y: 0, w: 200, h: 40 });
    const built = b.build();
    const records = built.records as Record<string, Record<string, unknown>>;
    (records[right] as Record<string, unknown>)['text'] = doc(
      para({ align: 'right' }, text('ab')),
      para({}, text('cd', [{ type: 'link', attrs: { href: '#screen:abc' } }])),
    );
    const { svg } = await exportSvg(built, { package: false }, { registries, measurer: tens });
    expect(svg11Problems(svg)).toEqual([]);
    // 'ab' is 20 px wide: right-aligned in a 200 px box it starts at 180, whatever the text element's own alignment
    expect(svg).toMatch(/<tspan x="180" y="[^"]+"><tspan x="180">ab<\/tspan><\/tspan>/);
    expect(svg).toMatch(/<tspan x="[^"]+" text-decoration="underline" fill="#0000ee">cd<\/tspan>/);
    expect(svg).not.toContain('<a ');
  });

  it('FR-EXP-004: a bullet nested past the second level is a circle, as the html leaf draws it', async () => {
    const b = documentBuilder({ seed: 2043 });
    const s = b.screen({ size: { w: 400, h: 200 } });
    const box = b.text(s, 'x', { x: 0, y: 0, w: 300, h: 160 });
    const built = b.build();
    const item = (t: string, ...nested: unknown[]) => ({ type: 'listItem', content: [para({}, text(t)), ...nested] });
    const list = (...items: unknown[]) => ({ type: 'bulletList', content: items });
    const four = list(item('four'));
    const three = list(item('three', four));
    const two = list(item('two', three));
    const records = built.records as Record<string, Record<string, unknown>>;
    (records[box] as Record<string, unknown>)['text'] = doc(list(item('one', two)));
    const { svg } = await exportSvg(built, { package: false }, { registries, measurer: tens });
    const markers = [...svg.matchAll(/text-anchor="end">([^<]+)<\/tspan>/g)].map((m) => m[1]);
    expect(markers).toEqual(['•', '◦', '◦', '◦']);
  });

  it('FR-EXP-004: a table draws each cell at its place with its border, fill and text', async () => {
    const file = read('examples/masters-tables.flux.json');
    const { svg, diagnostics } = await exportSvg(file, { screenId: '6UTNKFTvIaU4KrF97QOw2P' as RecordId, package: false }, { registries });
    expect(svg11Problems(svg)).toEqual([]);
    expect(diagnostics.filter((d) => d.code === 'FLX_EXPORT_NO_SVG_VIEW')).toEqual([]);
    const table = Object.values(file.records).find((r) => r.type === 'element' && (r as { kind?: string }).kind === 'table') as { id: string; cells: object };
    const group = svg.slice(svg.indexOf(`fluxion:el="${table.id}"`));
    const cells = group.slice(0, group.indexOf('</svg>')).match(/<rect x=/g) ?? [];
    expect(cells.length).toBeGreaterThanOrEqual(Object.keys(table.cells).length);
    expect(group).toContain('>Stream</tspan>');
    expect(group).toMatch(/<rect x="0" y="0" width="[^"]+" height="[^"]+" fill="#[0-9a-fA-F]{3,8}" stroke="/);
  });

  it("FR-EXP-004: a shape's further text regions and icon slots draw in their boxes; the first region's key is not drawn twice", async () => {
    const b = documentBuilder({ seed: 2042 });
    const s = b.screen({ size: { w: 400, h: 300 } });
    const card = b.rect(s, { x: 20, y: 20, w: 200, h: 120, defId: 'test:card', label: 'Title' });
    const pictured = b.rect(s, { x: 20, y: 160, w: 200, h: 120, defId: 'test:card', label: 'Pictured' });
    const built = b.build();
    const records = built.records as Record<string, Record<string, unknown>>;
    Object.assign(records[card] as object, {
      texts: { body: doc(para({}, text('Body text'))), title: doc(para({}, text('not drawn'))) },
      icons: { icon: { defId: 'basic:rect' } },
    });
    Object.assign(records[pictured] as object, { icons: { icon: { assetId: 'img1' } } });
    records['img1'] = { id: 'img1', type: 'asset', hash: '0'.repeat(64), mime: 'image/png', size: 72, name: 'p.png', w: 2, h: 1 };
    const { svg } = await exportSvg(built, { package: false }, { registries, assets: (id) => (id === 'img1' ? PNG : undefined) });
    expect(svg11Problems(svg)).toEqual([]);
    const first = svg.slice(svg.indexOf(`fluxion:el="${card}"`), svg.indexOf(`fluxion:el="${pictured}"`));
    expect(first).toContain('>Body text</tspan>');
    expect(first).not.toContain('not drawn');
    // the slot is 50 × 30 at the card's corner, the outline filled in the text colour
    expect(first).toMatch(/<path d="M0 0 L50 0 L50 30 L0 30 Z" transform="translate\(0 0\)" fill="#[0-9a-fA-F]{3,8}"><\/path>/);
    expect(svg.slice(svg.indexOf(`fluxion:el="${pictured}"`))).toContain(`<image x="0" y="0" width="50" height="30" xlink:href="${PNG}"`);
  });
});
