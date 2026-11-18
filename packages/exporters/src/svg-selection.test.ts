import { readFileSync } from 'node:fs';
import { createRegistry, type ShapeDef, sha256Hex } from '@fluxion/core';
import { loadFlux } from '@fluxion/format';
import { builtinRegistries } from '@fluxion/render';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder, plainText } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';
import { svg11Problems } from './svg11.js';

const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } }, 'test');
shapeDefs.register(
  'basic:rounded-rect',
  { id: 'basic:rounded-rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } },
  'test',
);
const registries = builtinRegistries(shapeDefs);
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
const read = (path: string): DocumentFile => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));

/** A screen of a group of two members, two loose shapes (one shadowed), and connectors between them. */
function board() {
  const b = documentBuilder({ title: 'Selection', seed: 2043 });
  const s = b.screen({ size: { w: 800, h: 600 } });
  const group = 'groupSelection1' as RecordId;
  const inner = b.rect(s, { x: 100, y: 100, w: 50, h: 40, parentId: group });
  const inner2 = b.rect(s, { x: 170, y: 100, w: 50, h: 40, parentId: group });
  const a = b.rect(s, { x: 300, y: 300, w: 100, h: 50 });
  const c = b.rect(s, { x: 600, y: 400, w: 80, h: 60, style: { shadow: [{ x: 6, y: 6, blur: 4, spread: 2, color: '#000000' }] } as never });
  const ab = b.connect(inner, a);
  const ac = b.connect(a, c);
  const free = b.connect(a, { x: 700, y: 50 });
  const built = b.build();
  const records = {
    ...built.records,
    [group]: { id: group, type: 'element', screenId: s, index: 'a0', kind: 'group', transform: { x: 100, y: 100, w: 120, h: 40 } },
  };
  return { file: { ...built, records } as DocumentFile, ids: { s, group, inner, inner2, a, c, ab, ac, free } };
}

const drawnIds = (svg: string) => [...svg.matchAll(/fluxion:el="([^"]+)"/g)].map((m) => m[1]);

describe('exportSvg: a selection (ADR-0056 items 6 and 7, M20.43)', () => {
  it('FR-EXP-004: a selection draws its elements and their members, and a connector only when both its ends are drawn', async () => {
    const { file, ids } = board();
    const { svg } = await exportSvg(file, { selection: [ids.group, ids.a, ids.free] }, { registries });
    expect(svg11Problems(svg)).toEqual([]);
    const drawn = drawnIds(svg);
    // the group brings its members; inner→a has both ends drawn; a→c and the free connector (selected) do not
    expect(drawn.sort()).toEqual([ids.group, ids.inner, ids.inner2, ids.a, ids.ab].sort());
    expect(svg).toMatch(/<fluxion:package [^>]*scope="selection"/);
  });

  it("FR-EXP-004: a selected group's member connector is drawn by its ends too, never by its group (M20.43 r2 F1)", async () => {
    const { file, ids } = board();
    const records = file.records as unknown as Record<string, { parentId?: RecordId }>;
    // inner→a and the free connector become members of the group; a stays outside it
    const grouped = {
      ...file,
      records: { ...records, [ids.ab]: { ...records[ids.ab], parentId: ids.group }, [ids.free]: { ...records[ids.free], parentId: ids.group } },
    } as unknown as DocumentFile;
    const alone = await exportSvg(grouped, { selection: [ids.group] }, { registries });
    expect(drawnIds(alone.svg).sort()).toEqual([ids.group, ids.inner, ids.inner2].sort());
    const both = await exportSvg(grouped, { selection: [ids.group, ids.a], package: false }, { registries });
    expect(drawnIds(both.svg).sort()).toEqual([ids.group, ids.inner, ids.inner2, ids.a, ids.ab].sort());
  });

  it('FR-EXP-004: the viewBox is the outset world bounds of what is drawn, rounded out to whole px', async () => {
    const { file, ids } = board();
    // a (300,300 100×50): a 2 px mitred stroke reaches 1 × 4 = 4; c (600,400 80×60): its filter region's margin,
    // ceil(6 + 1.5 × 4 + 2 + 4) + 1 = 19, as its <filter> is drawn; the connector a→c lies between them
    const { svg } = await exportSvg(file, { selection: [ids.a, ids.c], package: false }, { registries });
    expect(svg).toMatch(/<svg [^>]*width="403" height="183" viewBox="296 296 403 183"/);
    expect(svg).toMatch(/<filter [^>]*x="-19" y="-19"/);
    const turned = structuredClone(file) as DocumentFile & { records: Record<string, { transform?: object }> };
    // a quarter turn about its centre: 100×50 at (300,300) covers 325..375 × 275..375, outset 4
    (turned.records[ids.a] as { transform: object }).transform = { x: 300, y: 300, w: 100, h: 50, rot: 90 };
    const rotated = await exportSvg(turned, { selection: [ids.a], package: false }, { registries });
    expect(rotated.svg).toMatch(/viewBox="321 271 58 108"/);
  });

  it('FR-EXP-004: the viewBox adds a stroke to a hard shadow, never the larger of the two (M20.43 r1 F1)', async () => {
    const b = documentBuilder({ title: 'Hard shadow', seed: 2044 });
    const s = b.screen({ size: { w: 400, h: 300 } });
    const style = { stroke: { width: 8, join: 'bevel' }, shadow: [{ x: 10, y: 0, blur: 0, spread: 0, color: '#000000' }] };
    const r = b.rect(s, { x: 100, y: 100, w: 100, h: 50, style: style as never });
    const { svg } = await exportSvg(b.build(), { selection: [r], package: false }, { registries });
    // a bevelled 8 px stroke reaches 4√2 ≈ 5.66; with the 10 px shadow, ceil(10 + 5.66) + 1 = 17: the shadow's far edge at
    // 200 + 10 + 5.66 lies inside 217, where the larger of the two alone (10) would cut it at 210
    expect(svg).toMatch(/viewBox="83 83 134 84"/);
  });

  it("FR-EXP-004: the viewBox takes in a drawn connector's route, markers and labels, not only the boxes (M20.43 r1 F2)", async () => {
    const b = documentBuilder({ title: 'Over the top', seed: 2045 });
    const s = b.screen({ size: { w: 800, h: 600 } });
    const left = b.rect(s, { x: 100, y: 300, w: 80, h: 40 });
    const right = b.rect(s, { x: 300, y: 300, w: 80, h: 40 });
    const top = { kind: 'side', side: 'n' } as const;
    const over = b.connect(left, right, { route: 'orthogonal', sourceAnchor: top, targetAnchor: top });
    const built = b.build();
    const { svg } = await exportSvg(built, { selection: [left, right], package: false }, { registries });
    const [x, y, w, h] = (/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)?.slice(1) ?? []).map(Number) as [number, number, number, number];
    const route = new RegExp(`fluxion:el="${over}"[\\s\\S]*?<path d="([^"]+)"[^>]*stroke-width="([\\d.]+)"`).exec(svg);
    const points = [...(route?.[1] ?? '').matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const half = Number(route?.[2]) / 2;
    expect(Math.min(...points.map((p) => p.y))).toBeLessThan(300 - 4);
    for (const p of points) {
      expect(p.x - half).toBeGreaterThanOrEqual(x);
      expect(p.y - half).toBeGreaterThanOrEqual(y);
      expect(p.x + half).toBeLessThanOrEqual(x + w);
      expect(p.y + half).toBeLessThanOrEqual(y + h);
    }
    // a label wider than the two shapes together widens the viewBox past them
    const long = 'a label far wider than the two shapes and the route between them';
    const records = { ...built.records, [over]: { ...built.records[over], labels: [{ text: plainText(long), position: 0.5 }] } };
    const labelled = await exportSvg({ ...built, records } as DocumentFile, { selection: [left, right], package: false }, { registries });
    const [lx, , lw] = (/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(labelled.svg)?.slice(1) ?? []).map(Number) as [number, number, number];
    expect(labelled.svg).toContain(long.split(' ')[0] as string);
    expect(lx).toBeLessThan(x);
    expect(lx + lw).toBeGreaterThan(x + w);
  });

  it('FR-EXP-004: a selection on a mastered screen draws no master, and its package holds the selection and the closure it names', async () => {
    const file = read('examples/masters-tables.flux.json');
    const screenId = '6UTNKFTvIaU4KrF97QOw2P' as RecordId;
    const own = Object.values(file.records).filter((r) => r.type === 'element' && (r as { screenId?: string }).screenId === screenId);
    const picked = own.find((r) => (r as { kind?: string }).kind !== 'connector' && (r as { parentId?: string }).parentId === undefined);
    if (picked === undefined) throw new Error('no element');
    const { svg } = await exportSvg(file, { screenId, selection: [picked.id] }, { registries });
    expect(svg11Problems(svg)).toEqual([]);
    expect(svg).not.toContain('fluxion:master=');
    const m = /<fluxion:package [^>]*sha256="([0-9a-f]{64})"[^>]*>([A-Za-z0-9+/=]+)<\/fluxion:package>/.exec(svg);
    const bytes = Uint8Array.from(atob(m?.[2] as string), (c) => c.charCodeAt(0));
    const loaded = await loadFlux(bytes, { hasher });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const records = Object.values(loaded.value.document.records);
    const placed = records.filter((r) => r.type === 'element' && (r as { screenId?: string }).screenId === screenId).map((r) => r.id);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(own.length);
    expect(placed).toContain(picked.id);
  });

  it('FR-EXP-004: a selected member without its group keeps the parent chain in the package, which reopens unrepaired (M20.43 r1 F3)', async () => {
    const { file, ids } = board();
    const { svg } = await exportSvg(file, { selection: [ids.inner] }, { registries });
    expect(drawnIds(svg)).toEqual([ids.inner]);
    const m = /<fluxion:package [^>]*>([A-Za-z0-9+/=]+)<\/fluxion:package>/.exec(svg);
    const loaded = await loadFlux(
      Uint8Array.from(atob(m?.[1] as string), (c) => c.charCodeAt(0)),
      { hasher },
    );
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    expect(loaded.value.diagnostics.filter((d) => d.code.startsWith('FLX_REPAIRED'))).toEqual([]);
    const kept = Object.keys(loaded.value.document.records);
    expect(kept).toContain(ids.inner);
    expect(kept).toContain(ids.group);
    expect(kept).not.toContain(ids.inner2);
  });
});
