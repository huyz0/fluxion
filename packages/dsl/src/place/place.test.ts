import { createCoreRegistries, type ShapeDef, sha256Hash128, stableId } from '@fluxion/core';
import { type LayoutAlgorithm, type LayoutInput, registerBuiltInLayouts } from '@fluxion/layout';
import { type AnyRecord, SCHEMA_VERSION, validate } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { expandFlux } from '../expand/expand.js';
import { parseFlux } from '../parse/parse.js';
import { readFlux } from '../read/read.js';
import { resolveFlux } from '../resolve/resolve.js';
import { type PlaceResult, placeFlux } from './place.js';

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type El = AnyRecord & {
  readonly kind?: string;
  readonly transform?: Box;
  readonly parentId?: string;
  readonly screenId?: string;
  readonly placement?: string;
};

/** Registries with a few shapes and the built-in layouts, plus whatever `extra` registers. */
function registries(extra?: (r: ReturnType<typeof createCoreRegistries>) => void) {
  const r = createCoreRegistries();
  const sized: { readonly [id: string]: { w: number; h: number } } = { 'basic:rounded-rect': { w: 200, h: 100 } };
  for (const id of ['basic:rect', 'basic:rounded-rect'])
    r.shapeDefs.register(id, { id, ...(sized[id] ? { defaultSize: sized[id] } : {}) } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  extra?.(r);
  return r;
}

/** parse → read → resolve → expand → place. */
function place(text: string, reg = registries()): PlaceResult {
  const parsed = parseFlux(text);
  if (!parsed.root) throw new Error(JSON.stringify(parsed.diagnostics));
  const read = readFlux(parsed.root, text);
  if (!read.ast) throw new Error(JSON.stringify(read.diagnostics));
  const resolved = resolveFlux(read.ast, reg);
  const errors = [...read.diagnostics, ...resolved.diagnostics].filter((d) => d.code !== 'FLX_DSL_NOT_YET');
  if (errors.length) throw new Error(JSON.stringify(errors));
  const expanded = expandFlux(read.ast, resolved.resolution, { registries: reg });
  if (expanded.diagnostics.length) throw new Error(JSON.stringify(expanded.diagnostics));
  return placeFlux(expanded, { registries: reg });
}

const doc = (body: string) => `flux: 1\ntitle: Mixed\nuses: [basic]\nscreens:\n${body}`;
const id = (key: string) => stableId(sha256Hash128, '', key);
const el = (r: PlaceResult, slug: string) => r.records[id(`node:${slug}`)] as El;
const box = (r: PlaceResult, slug: string) => el(r, slug).transform as Box;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Whether `a` is `b` or holds it, at any depth. */
function holds(els: ReadonlyMap<string, El>, a: El, b: El): boolean {
  for (let at: El | undefined = b; at !== undefined; at = at.parentId ? els.get(at.parentId) : undefined) if (at.id === a.id) return true;
  return false;
}

/**
 * Pairs of overlapping boxes on a screen, across containers: every two leaves (elements that hold nothing), and every two groups neither
 * of which holds the other.
 */
function overlapping(r: PlaceResult): string[][] {
  const els = new Map(
    Object.values(r.records)
      .filter((x) => x.type === 'element' && (x as El).transform !== undefined)
      .map((x) => [String(x.id), x as El]),
  );
  const parents = new Set([...els.values()].flatMap((e) => (e.parentId ? [e.parentId] : [])));
  const list = [...els.values()];
  const out: string[][] = [];
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      const [ga, gb] = [parents.has(String(a.id)) || a.kind === 'group', parents.has(String(b.id)) || b.kind === 'group'];
      const compared = ga === gb && (!ga || (!holds(els, a, b) && !holds(els, b, a)));
      if (a.screenId === b.screenId && compared && overlaps(a.transform as Box, b.transform as Box)) out.push([String(a.id), String(b.id)]);
    }
  });
  return out;
}

const MIXED = doc(`  - id: one
    nodes:
      web: { shape: rect, label: Web }
      pinned: { shape: rect, label: Pinned, pin: { x: 80, y: 150, w: 300, h: 120 } }
      api: { shape: rounded-rect, label: API }
      db: { shape: rect, label: DB }
      cache: { shape: rect, label: Cache }
      queue: { shape: rect, label: Queue, pin: { x: 1200, y: 600, w: 200, h: 100 } }
      worker: { shape: rect, label: Worker }
      note: { text: Hello }
    groups:
      backend: { label: Backend, contains: [api, data], layout: { type: stack, direction: right, gap: 40 } }
      data: { label: Data, contains: [db, cache] }
      jobs: { contains: [queue, worker] }
    edges:
      - web -> api
      - api -> db
`);

describe('place stage (FR-DSL-005, ADR-0030)', () => {
  it('FR-DSL-005: in a mixed fixture pinned boxes are exact and the others are placed without overlap', () => {
    const r = place(MIXED);
    expect(r.diagnostics).toEqual([]);
    expect(box(r, 'pinned')).toEqual({ x: 80, y: 150, w: 300, h: 120 });
    expect(box(r, 'queue')).toEqual({ x: 1200, y: 600, w: 200, h: 100 });
    expect(el(r, 'pinned').placement).toBe('pinned');
    expect(overlapping(r)).toEqual([]);
    // the auto ones moved off the origin they were expanded at, keeping their size
    expect(box(r, 'web')).toMatchObject({ w: 160, h: 80 });
    expect(box(r, 'api')).toMatchObject({ w: 200, h: 100 });
    expect([box(r, 'web').x, box(r, 'web').y]).not.toEqual([0, 0]);
  });

  it('FR-DSL-005: a group encloses its members, nested groups too, and follows its own layout', () => {
    const r = place(MIXED);
    for (const [g, members] of [
      ['backend', ['api', 'data']],
      ['data', ['db', 'cache']],
      ['jobs', ['queue', 'worker']],
    ] as const) {
      for (const m of members) {
        expect(el(r, m).parentId).toBe(id(`node:${g}`));
        expect(inside(box(r, m), box(r, g)), `${m} in ${g}`).toBe(true);
      }
    }
    // backend stacks right with a gap of 40, in model order (z-order: groups behind nodes, so data before api), on one top line
    expect(box(r, 'api').x).toBe(box(r, 'data').x + box(r, 'data').w + 40);
    expect(box(r, 'api').y).toBe(box(r, 'data').y);
    // data stacks down with the defaults (gap 24)
    expect(box(r, 'cache').y).toBe(box(r, 'db').y + box(r, 'db').h + 24);
    // a group's box is the bounds of its members (02 §3, the core:5-group-bounds hook)
    const d = box(r, 'data');
    expect(d).toEqual({ x: box(r, 'db').x, y: box(r, 'db').y, w: 160, h: 80 + 24 + 80 });
    // a group holding a pin keeps the pin exact and is not moved off it
    expect(inside(box(r, 'queue'), box(r, 'jobs'))).toBe(true);
  });

  it('FR-DSL-005: the placed document validates, inputs are not changed, and placing is deterministic', () => {
    const reg = registries();
    const text = MIXED;
    const parsed = parseFlux(text);
    const read = readFlux(parsed.root as NonNullable<typeof parsed.root>, text);
    const ast = read.ast as NonNullable<typeof read.ast>;
    const expanded = expandFlux(ast, resolveFlux(ast, reg).resolution, { registries: reg });
    const before = JSON.stringify(expanded.records);
    const a = placeFlux(expanded, { registries: reg });
    const b = placeFlux(expanded, { registries: reg });
    expect(JSON.stringify(expanded.records)).toBe(before);
    expect(a).toEqual(b);
    expect(validate({ schemaVersion: SCHEMA_VERSION, records: a.records }).filter((x) => x.severity === 'error')).toEqual([]);
    // connectors are not placed: no transform
    const connectors = Object.values(a.records).filter((x) => x.type === 'element' && (x as El).transform === undefined);
    expect(connectors).toHaveLength(2);
  });

  it('FR-DSL-005: the auto members of a group holding a pin avoid every pin outside it, and stay on the screen', () => {
    const r = place(
      doc(`  - id: one
    nodes:
      queue: { shape: rect, pin: { x: 1200, y: 600, w: 200, h: 100 } }
      worker: { shape: rect }
      p: { shape: rect, pin: { x: 1250, y: 730, w: 100, h: 50 } }
    groups:
      jobs: { contains: [queue, worker] }
`),
    );
    expect(r.diagnostics).toEqual([]);
    expect(box(r, 'queue')).toEqual({ x: 1200, y: 600, w: 200, h: 100 });
    expect(box(r, 'p')).toEqual({ x: 1250, y: 730, w: 100, h: 50 });
    expect(overlaps(box(r, 'worker'), box(r, 'p'))).toBe(false);
    expect(overlapping(r)).toEqual([]);
    expect(inside(box(r, 'worker'), { x: 0, y: 0, w: 1920, h: 1080 })).toBe(true);
  });

  it('FR-DSL-005: a group holding a pin near the screen edge places its auto members on the screen', () => {
    const r = place(
      doc(`  - id: one
    nodes:
      queue: { shape: rect, pin: { x: 1200, y: 1000, w: 200, h: 80 } }
      worker: { shape: rect }
    groups:
      jobs: { contains: [queue, worker] }
`),
    );
    expect(box(r, 'queue')).toEqual({ x: 1200, y: 1000, w: 200, h: 80 });
    expect(inside(box(r, 'worker'), { x: 0, y: 0, w: 1920, h: 1080 })).toBe(true);
    expect(overlapping(r)).toEqual([]);
  });

  it('FR-DSL-005: `layered`, named by v1 but not registered in R2, places with stack and warns FLX_DSL_NOT_YET at the layout', () => {
    const r = place(doc('  - id: a\n    layout: { type: layered, direction: right }\n    nodes:\n      x: { shape: rect }\n      y: { shape: rect }\n'));
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.path, d.source?.line])).toEqual([['FLX_DSL_NOT_YET', 'warning', '/screens/0/layout/type', 6]]);
    // stack defaults: down from padding 80, gap 24
    expect(box(r, 'x')).toEqual({ x: 80, y: 80, w: 160, h: 80 });
    expect(box(r, 'y')).toEqual({ x: 80, y: 184, w: 160, h: 80 });
  });

  it('FR-DSL-005: an unknown layout type is FLX_REF_MISSING with a did-you-mean from the registry, and places with stack', () => {
    const r = place(
      doc('  - id: a\n    nodes:\n      x: { shape: rect }\n      y: { shape: rect }\n    groups:\n      g: { contains: [x, y], layout: { type: stak } }\n'),
    );
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.path, d.source?.line, d.hint])).toEqual([
      ['FLX_REF_MISSING', 'error', '/screens/0/groups/g/layout/type', 10, 'did you mean "stack"?'],
    ]);
    expect(box(r, 'y').y).toBe(box(r, 'x').y + 80 + 24);
  });

  it("FR-DSL-005: a registered layout is looked up by type and run on the container's members with its options", () => {
    const calls: Array<{ input: LayoutInput; options: unknown }> = [];
    const fan: LayoutAlgorithm<{ step: number }> = {
      id: 'test:fan',
      version: '1',
      parseOptions: (raw) => ({ ok: true, value: { step: Number((raw as { step?: number } | undefined)?.step ?? 10) } }),
      run: (input, options) => {
        calls.push({ input, options });
        return { boxes: Object.fromEntries(input.nodes.map((n, i) => [n.id, { ...n.box, x: 1000 + i * (n.box.w + options.step), y: 500 }])) };
      },
    };
    const reg = registries((x) => x.layouts.register('test:fan', fan, 'test'));
    const r = place(
      doc(
        '  - id: a\n    layout: { type: test:fan, step: 7 }\n    nodes:\n      x: { shape: rect }\n      y: { shape: rect, pin: { x: 0, y: 0 } }\n      z: { shape: rect }\n',
      ),
      reg,
    );
    expect(r.diagnostics).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ step: 7 });
    expect(calls[0]?.input.nodes.map((n) => [n.id, n.pinned ?? false])).toEqual([
      [id('node:x'), false],
      [id('node:y'), true],
      [id('node:z'), false],
    ]);
    expect(calls[0]?.input.frame).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(box(r, 'x')).toEqual({ x: 1000, y: 500, w: 160, h: 80 });
    // a pinned node keeps its box whatever the layout returns
    expect(box(r, 'y')).toEqual({ x: 0, y: 0, w: 160, h: 80 });
    expect(box(r, 'z')).toEqual({ x: 1334, y: 500, w: 160, h: 80 });
  });

  it('FR-DSL-005: options the layout refuses are FLX_SCHEMA_INVALID at the layout, and it runs with its defaults', () => {
    const r = place(doc('  - id: a\n    layout: { type: stack, direction: sideways }\n    nodes:\n      x: { shape: rect }\n'));
    expect(r.diagnostics.map((d) => [d.code, d.path, d.source?.line, d.message])).toEqual([
      ['FLX_SCHEMA_INVALID', '/screens/0/layout', 6, 'layout "stack": direction must be "down" or "right"'],
    ]);
    expect(box(r, 'x')).toEqual({ x: 80, y: 80, w: 160, h: 80 });
  });
});
