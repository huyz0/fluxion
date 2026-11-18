import { readFileSync } from 'node:fs';
import { createRegistry, parseShapeDef, type ShapeDef } from '@fluxion/core';
import { builtinRegistries } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';
import { svg11Problems } from './svg11.js';

const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } }, 'test');
const artwork = parseShapeDef(JSON.parse(readFileSync(new URL('../../../fixtures/artwork/paint.shape.json', import.meta.url), 'utf8')));
if (!artwork.ok) throw new Error(JSON.stringify(artwork.error));
shapeDefs.register(artwork.value.id, artwork.value, 'test');
const registries = builtinRegistries(shapeDefs);

/** A 2 × 1 PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGGAMAEn0Av5S3fBPAAAAAElFTkSuQmCC';
const assets = (id: RecordId) => (id === 'img1' ? PNG : undefined);

/** A screen of a clipping frame and its member, an unclipped frame, images, an image fill, a shadowed shape, artwork and components. */
function boxes(): { readonly file: DocumentFile; readonly ids: Readonly<Record<string, RecordId>> } {
  const b = documentBuilder({ title: 'Boxes', seed: 2040 });
  const s = b.screen({ name: 'Boxes', size: { w: 960, h: 540 } });
  const frame = 'frameClips00001' as RecordId;
  const open = 'frameOpen000001' as RecordId;
  const member = b.rect(s, { x: 150, y: 120, w: 200, h: 80, label: 'clipped', parentId: frame });
  const loose = b.rect(s, { x: 500, y: 120, w: 160, h: 60, parentId: open });
  const shadowed = b.rect(s, {
    x: 40,
    y: 300,
    w: 160,
    h: 90,
    label: 'lit',
    style: {
      shadow: [
        { x: 6, y: 6, blur: 4, spread: 2, color: '#000000' },
        { x: 0, y: 0, blur: 3, color: '#ff0000', inset: true },
      ],
      effects: [
        { type: 'glow', radius: 4, color: '#00ff00' },
        { type: 'blur', radius: 1 },
      ],
    } as never,
  });
  const tiled = b.rect(s, { x: 240, y: 300, w: 120, h: 90, style: { fill: { type: 'image', assetId: 'img1', fit: 'tile' } } as never });
  const art = b.rect(s, { x: 400, y: 300, w: 100, h: 100, defId: 'test:artwork' });
  const built = b.build();
  const place = (id: string, index: string, rest: object) => ({ id, type: 'element', screenId: s, index, ...rest });
  const records: Record<string, unknown> = {
    ...built.records,
    [frame]: place(frame, 'a00', { kind: 'frame', transform: { x: 100, y: 100, w: 200, h: 150, rot: 15 }, style: { radius: 16 } }),
    [open]: place(open, 'a01', { kind: 'frame', clip: false, transform: { x: 480, y: 100, w: 120, h: 60 } }),
    img1: { id: 'img1', type: 'asset', hash: '0'.repeat(64), mime: 'image/png', size: 72, name: 'p.png', w: 2, h: 1 },
    image0000000001: place('image0000000001', 'z0', { kind: 'image', assetId: 'img1', fit: 'cover', transform: { x: 700, y: 40, w: 100, h: 80 } }),
    image0000000002: place('image0000000002', 'z1', {
      kind: 'image',
      assetId: 'img1',
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
      maskDefId: 'basic:rect',
      transform: { x: 820, y: 40, w: 100, h: 80 },
    }),
    component000001: place('component000001', 'z2', {
      kind: 'component',
      componentId: 'acme:chart',
      props: {},
      snapshotAssetId: 'img1',
      transform: { x: 700, y: 300, w: 120, h: 80 },
    }),
    component000002: place('component000002', 'z3', { kind: 'component', componentId: 'acme:chart', props: {}, transform: { x: 840, y: 300, w: 100, h: 80 } }),
  };
  return { file: { ...built, records } as DocumentFile, ids: { frame, open, member, loose, shadowed, tiled, art } };
}

/** The markup of element `id`'s group and what follows it, up to the next element's group. */
const groupOf = (svg: string, id: string) => {
  const at = svg.indexOf(`fluxion:el="${id}"`);
  const next = svg.indexOf('fluxion:el="', at + 1);
  return svg.slice(at, next < 0 ? undefined : next);
};

describe('exportSvg: boxed leaves (ADR-0056 items 8 and 9, M20.40)', () => {
  it('FR-EXP-004: a frame clips its members in screen coordinates, turned as it is; clip false does not', async () => {
    const { file, ids } = boxes();
    const { svg, diagnostics } = await exportSvg(file, { package: false }, { registries, assets });
    expect(svg11Problems(svg)).toEqual([]);
    await expect(svg).toMatchFileSnapshot('../__golden__/boxes.svg');
    expect(diagnostics.filter((d) => d.code === 'FLX_EXPORT_NO_SVG_VIEW')).toEqual([]);
    const clip =
      /<clipPath id="([^"]+)"><rect x="100" y="100" width="200" height="150" rx="16" transform="rotate\(15 200 175\)"><\/rect><\/clipPath><\/defs><g clip-path="url\(#([^"]+)\)">(.*?)<\/g><\/g><g fluxion:el/.exec(
        svg,
      );
    expect(clip?.[1]).toBe(clip?.[2]);
    expect(clip?.[3]).toContain(`fluxion:el="${ids['member']}"`);
    // the frame's own box: its style's radius, as the html leaf draws it
    expect(groupOf(svg, ids['frame'] as string)).toMatch(/<rect x="0" y="0" width="200" height="150" rx="16"/);
    expect(groupOf(svg, ids['open'] as string)).not.toContain('clip-path');
  });

  it('FR-EXP-004: images, image fills and component snapshots draw from data URLs; without bytes they are reported, never fetched', async () => {
    const { file, ids } = boxes();
    const { svg, diagnostics } = await exportSvg(file, { package: false }, { registries, assets });
    expect(groupOf(svg, 'image0000000001')).toContain(`<image x="0" y="0" xlink:href="${PNG}" width="100" height="80" preserveAspectRatio="xMidYMid slice">`);
    // a crop is the viewBox of a nested svg, clipped; the mask is the shape's outline
    expect(groupOf(svg, 'image0000000002')).toMatch(/<svg x="0" y="0" width="100" height="80" viewBox="1 0 1 1" preserveAspectRatio="xMidYMid meet">/);
    expect(groupOf(svg, 'image0000000002')).toMatch(/<clipPath id="[^"]+"><path d="M0 0 L100 0 L100 80 L0 80 Z"><\/path><\/clipPath>/);
    expect(groupOf(svg, ids['tiled'] as string)).toContain(`<pattern id="fx1-`);
    expect(groupOf(svg, ids['tiled'] as string)).toContain(`<image xlink:href="${PNG}" width="2" height="1" preserveAspectRatio="none">`);
    expect(groupOf(svg, 'component000001')).toContain(`<image x="0" y="0" width="120" height="80" preserveAspectRatio="none" xlink:href="${PNG}">`);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'FLX_EXPORT_NO_SNAPSHOT', elementId: 'component000002' }));
    const bare = await exportSvg(file, { package: false }, { registries });
    expect(bare.svg).not.toContain('<image');
    expect(svg11Problems(bare.svg)).toEqual([]);
    const missing = bare.diagnostics.filter((d) => d.code === 'FLX_EXPORT_ASSET_MISSING').map((d) => d.elementId);
    expect(missing.sort()).toEqual(['component000001', 'image0000000001', 'image0000000002', ids['tiled']].sort());
    // a host URL that is not data: (a blob or an http URL) is never written
    const blob = await exportSvg(file, { package: false }, { registries, assets: () => 'blob:https://studio.invalid/1' });
    expect(blob.svg).not.toContain('blob:');
  });

  it('FR-EXP-004: shadows and effects are SVG 1.1 filters with literal floods; artwork is inlined with literal colours and its own ids', async () => {
    const { file, ids } = boxes();
    const { svg } = await exportSvg(file, { package: false }, { registries, assets });
    const shadowed = groupOf(svg, ids['shadowed'] as string);
    expect(shadowed).toMatch(/<filter id="([^"]+)" filterUnits="userSpaceOnUse"[^>]*>.*<\/filter><\/defs><g filter="url\(#\1\)">/);
    expect(shadowed).toContain('<feFlood flood-color="#000000"');
    expect(shadowed).toContain('<feFlood flood-color="#00ff00"');
    expect(shadowed).not.toMatch(/ style=/);
    expect(shadowed).not.toContain('feDropShadow');
    // the label stays outside the filter, as the html leaf keeps it sharp
    const filtered = /<g filter="url\(#[^"]+\)">(.*?)<\/g><text /.exec(shadowed);
    expect(filtered).not.toBeNull();
    expect(filtered?.[1]).not.toContain('<text');
    expect(shadowed.slice(shadowed.indexOf('<g filter='))).toMatch(/<\/g><text [^>]*>.*>lit ?<\/tspan>/);
    const art = groupOf(svg, ids['art'] as string);
    expect(art).toContain('<linearGradient id="fx1-');
    expect(art).not.toMatch(/url\(#paint\)|fx-artwork|aria-hidden|var\(/);
  });
});
