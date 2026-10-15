// FR-LAY-008 and FR-LAY-001: the layout pipeline (validation, seeded run, post-passes, fingerprint) and its cache.
import { describe, expect, it } from 'vitest';
import { createLayoutCache, createRng, fingerprintOf, gridLayout, layeredLayout, layoutSync, stackLayout } from './index.js';
import type { LaidOut, LayoutAlgorithm, LayoutInput, LayoutNode } from './types.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, order: number, [w, h]: readonly [number, number] = [100, 50], at?: { x: number; y: number }): LayoutNode => ({
  id,
  box: { x: at?.x ?? 0, y: at?.y ?? 0, w, h },
  order,
  ...(at ? { pinned: true } : {}),
});
const input = (nodes: readonly LayoutNode[], extra: Partial<LayoutInput> = {}): LayoutInput => ({ frame, nodes, ...extra });
const laid = (r: ReturnType<typeof layoutSync>): LaidOut => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** An algorithm that misbehaves on purpose: it puts every node at the same place, pinned ones included, and uses the random stream. */
const pileUp: LayoutAlgorithm<{ jitter: number }> = {
  id: 'test:pile',
  version: '3',
  schema: stackLayout.schema as never,
  capabilities: { pins: false, compound: false, runsIn: 'main' },
  parseOptions: (raw) => ({ ok: true, value: { jitter: Number((raw as { jitter?: number } | undefined)?.jitter ?? 0) } }),
  run: (inp, o, ctx) => ({ boxes: Object.fromEntries(inp.nodes.map((n) => [n.id, { ...n.box, x: 50 + o.jitter * (ctx?.rng() ?? 0), y: 50 }])) }),
};

describe('layout pipeline (FR-LAY-008)', () => {
  it('FR-LAY-008: the same request twice gives equal boxes and fingerprint, whatever the order of nodes, edges and keys', () => {
    const nodes = [node('a', 0), node('b', 1), node('c', 2)];
    const edges = [
      { id: 'e0', source: 'a', target: 'b', order: 0 },
      { id: 'e1', source: 'a', target: 'c', order: 1 },
    ];
    const first = laid(layoutSync({ input: input(nodes, { edges }), algorithm: layeredLayout }));
    expect(laid(layoutSync({ input: input(nodes, { edges }), algorithm: layeredLayout }))).toEqual(first);
    const shuffled = laid(layoutSync({ input: input([...nodes].reverse(), { edges: [...edges].reverse() }), algorithm: layeredLayout }));
    expect(shuffled).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it('FR-LAY-008: the fingerprint changes with the input, options, seed, algorithm version, font hash and post-passes', () => {
    const nodes = [node('a', 0), node('b', 1)];
    const base = { input: input(nodes), algorithm: pileUp };
    const key = (extra: object = {}, inp: LayoutInput = base.input) => {
      const r = fingerprintOf({ ...base, input: inp, ...extra } as never);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    const keys = new Set([
      key(),
      key({ options: { jitter: 5 } }),
      key({ seed: 1 }),
      key({ fontHash: 'abc' }),
      key({ post: ['pins'] }),
      key({ overlap: { margin: 4 } }),
      key({ algorithm: { ...pileUp, version: '4' } }),
      key({}, input([node('a', 0), node('b', 1, [101, 50])])),
      key({}, input(nodes, { scope: 'selection' })),
    ]);
    expect(keys.size).toBe(9);
    // the same request spelled another way has the same key: default options written out, passes in another order
    expect(key({ options: { jitter: 0 } })).toBe(key());
    expect(key({ post: ['snap', 'overlap', 'pins'] })).toBe(key());
  });

  it('FR-LAY-004: the pipeline puts pinned nodes back, removes overlap, snaps, and counts overlapping pinned pairs', () => {
    const nodes = [node('free', 0), node('p', 1, [100, 50], { x: 300, y: 200 }), node('q', 2, [100, 50], { x: 350, y: 220 })];
    const out = laid(layoutSync({ input: input(nodes), algorithm: pileUp, options: { jitter: 0 } }));
    expect(out.boxes['p']).toEqual({ x: 300, y: 200, w: 100, h: 50 });
    expect(out.boxes['q']).toEqual({ x: 350, y: 220, w: 100, h: 50 });
    const free = out.boxes['free'] as { x: number; y: number; w: number; h: number };
    expect((free.x * 2) % 1).toBe(0);
    expect(out.metrics).toEqual({ overlaps: 1, crossings: 0, bends: 0, ms: 0 });
    // without the passes the algorithm's pile comes back as it is
    const raw = laid(layoutSync({ input: input(nodes), algorithm: pileUp, options: { jitter: 0 }, post: [] }));
    expect(raw.boxes['p']).toEqual({ x: 50, y: 50, w: 100, h: 50 });
    expect(raw.metrics.overlaps).toBe(3);
  });

  it('FR-LAY-008: the algorithm gets a seeded stream: the same seed gives the same boxes, another seed other ones', () => {
    const nodes = [node('a', 0), node('b', 1)];
    const run = (seed: number) => laid(layoutSync({ input: input(nodes), algorithm: pileUp, options: { jitter: 1000 }, seed, post: [] })).boxes;
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    const draws = (seed: number) => Array.from({ length: 4 }, createRng(seed));
    expect(draws(1)).toEqual(draws(1));
    expect(draws(1)).not.toEqual(draws(2));
    expect(draws(0).every((v) => v >= 0 && v < 1)).toBe(true);
    // pinned known answers, cross-checked against an independent implementation of splitmix32 seeding and sfc32 (ADR-0034): a change to the
    // stream changes every seeded layout
    expect(draws(12345)).toEqual([0.498803693568334, 0.7180248491931707, 0.46510869706980884, 0.727176858112216]);
    const many = Array.from({ length: 2000 }, createRng(99));
    const mean = many.reduce((a, b) => a + b, 0) / many.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('FR-LAY-001: a duplicate id, a non-finite box or frame, bad options, a throwing algorithm or non-finite output is a LayoutError, not an exception', () => {
    const code = (r: ReturnType<typeof layoutSync>) => (r.ok ? 'ok' : r.error.code);
    expect(code(layoutSync({ input: input([node('a', 0), node('a', 1)]), algorithm: stackLayout }))).toBe('LAYOUT_INPUT_INVALID');
    expect(code(layoutSync({ input: input([{ ...node('a', 0), box: { x: Number.NaN, y: 0, w: 1, h: 1 } }]), algorithm: stackLayout }))).toBe(
      'LAYOUT_INPUT_INVALID',
    );
    expect(code(layoutSync({ input: input([{ ...node('a', 0), box: { x: 0, y: 0, w: -1, h: 1 } }]), algorithm: stackLayout }))).toBe('LAYOUT_INPUT_INVALID');
    expect(code(layoutSync({ input: { frame: { ...frame, w: Number.POSITIVE_INFINITY }, nodes: [] }, algorithm: stackLayout }))).toBe('LAYOUT_INPUT_INVALID');
    expect(code(layoutSync({ input: input([node('a', 0)]), algorithm: gridLayout, options: { columns: 0 } }))).toBe('LAYOUT_OPTIONS_INVALID');
    const throwing: LayoutAlgorithm<unknown> = {
      ...(pileUp as LayoutAlgorithm<unknown>),
      run: () => {
        throw new Error('boom');
      },
    };
    const thrown = layoutSync({ input: input([node('a', 0)]), algorithm: throwing });
    expect(thrown).toEqual({ ok: false, error: { code: 'LAYOUT_FAILED', message: 'the algorithm "test:pile" failed: boom' } });
    const nan: LayoutAlgorithm<unknown> = {
      ...(pileUp as LayoutAlgorithm<unknown>),
      run: (inp) => ({ boxes: { a: { ...inp.nodes[0]?.box, x: Number.NaN } as never } }),
    };
    expect(code(layoutSync({ input: input([node('a', 0)]), algorithm: nan }))).toBe('LAYOUT_FAILED');
    const empty: LayoutAlgorithm<unknown> = { ...(pileUp as LayoutAlgorithm<unknown>), run: () => ({ boxes: {} }) };
    expect(code(layoutSync({ input: input([node('a', 0)]), algorithm: empty }))).toBe('LAYOUT_FAILED');
    const needsText: LayoutAlgorithm<unknown> = {
      ...(pileUp as LayoutAlgorithm<unknown>),
      run: (_i, _o, ctx) => {
        ctx?.measure.measure('x', { family: 'f', size: 1 });
        return { boxes: {} };
      },
    };
    expect(layoutSync({ input: input([node('a', 0)]), algorithm: needsText })).toMatchObject({ ok: false, error: { code: 'LAYOUT_FAILED' } });
    expect(code(layoutSync({ input: input([node('__proto__', 0)]), algorithm: stackLayout }))).toBe('ok');
  });

  it('FR-LAY-001: options that throw, hold a BigInt, a cycle or a number that is not finite, and a NaN order, are LayoutError results; -0 and 0 fingerprint apart', () => {
    const nodes = [node('a', 0)];
    const options = (raw: unknown): LayoutAlgorithm<unknown> => ({ ...(pileUp as LayoutAlgorithm<unknown>), parseOptions: () => ({ ok: true, value: raw }) });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    for (const raw of [{ big: 1n }, cyclic, { gap: Number.POSITIVE_INFINITY }, { gap: Number.NaN }]) {
      expect(layoutSync({ input: input(nodes), algorithm: options(raw) })).toMatchObject({ ok: false, error: { code: 'LAYOUT_OPTIONS_INVALID' } });
      expect(fingerprintOf({ input: input(nodes), algorithm: options(raw) })).toMatchObject({ ok: false });
    }
    const throwing: LayoutAlgorithm<unknown> = {
      ...(pileUp as LayoutAlgorithm<unknown>),
      parseOptions: () => {
        throw new Error('bad schema');
      },
    };
    expect(layoutSync({ input: input(nodes), algorithm: throwing })).toMatchObject({ ok: false, error: { code: 'LAYOUT_OPTIONS_INVALID' } });
    expect(layoutSync({ input: input([{ ...node('a', 0), order: Number.NaN }]), algorithm: stackLayout })).toMatchObject({
      ok: false,
      error: { code: 'LAYOUT_INPUT_INVALID' },
    });
    expect(layoutSync({ input: input(nodes, { edges: [{ id: 'e', source: 'a', target: 'a', order: Number.NaN }] }), algorithm: stackLayout })).toMatchObject({
      ok: false,
    });
    const zero = fingerprintOf({ input: input(nodes), algorithm: options({ gap: 0 }) });
    const negative = fingerprintOf({ input: input(nodes), algorithm: options({ gap: -0 }) });
    expect(zero.ok && negative.ok && zero.value !== negative.value).toBe(true);
  });

  it('FR-LAY-008: the cache returns the stored result for an identical request without running the algorithm, and misses when anything differs', () => {
    let runs = 0;
    const counting: LayoutAlgorithm<{ jitter: number }> = {
      ...pileUp,
      run: (inp, o, ctx) => {
        runs += 1;
        return pileUp.run(inp, o, ctx);
      },
    };
    const cache = createLayoutCache(2);
    const req = { input: input([node('a', 0), node('b', 1)]), algorithm: counting };
    const first = cache.layout(req);
    const again = cache.layout(req);
    expect(first.ok && again.ok && again.value === first.value).toBe(true);
    expect(runs).toBe(1);
    cache.layout({ ...req, options: { jitter: 3 } });
    expect(runs).toBe(2);
    // the first request is used again, so the jitter one is the least recently used: a third request evicts it, not the first
    cache.layout(req);
    cache.layout({ ...req, seed: 9 });
    expect(cache.size()).toBe(2);
    cache.layout(req);
    expect(runs).toBe(3);
    cache.layout({ ...req, options: { jitter: 3 } });
    expect(runs).toBe(4);
    // a failure is not stored
    expect(cache.layout({ ...req, input: input([node('a', 0), node('a', 1)]) }).ok).toBe(false);
    expect(cache.size()).toBe(2);
    // a limit that is not a number of 1 or more is read as 64
    const odd = createLayoutCache(Number.NaN);
    for (let seed = 0; seed < 5; seed += 1) odd.layout({ ...req, seed });
    expect(odd.size()).toBe(5);
  });

  it("FR-LAY-008: a result is frozen, so a caller cannot change what the cache hands the next one, and the input boxes stay the caller's", () => {
    const pin = node('p', 1, [100, 50], { x: 10, y: 20 });
    const out = laid(layoutSync({ input: input([node('a', 0), pin]), algorithm: pileUp, options: { jitter: 0 } }));
    expect(Object.isFrozen(out) && Object.isFrozen(out.boxes) && Object.isFrozen(out.boxes['p']) && Object.isFrozen(out.metrics)).toBe(true);
    expect(() => {
      (out.boxes['p'] as { x: number }).x = 99;
    }).toThrow();
    expect(Object.isFrozen(pin.box)).toBe(false);
  });
});
