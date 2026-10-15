import { createCoreRegistries } from '@fluxion/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LayoutAlgorithm, type LayoutNode, registerBuiltInLayouts } from './index.js';
import { type StackOptions, stackLayout } from './stack.js';

const frame = { x: 0, y: 0, w: 1920, h: 1080 };
const node = (id: string, [w, h]: readonly [number, number], order: number, pinned?: { x: number; y: number }): LayoutNode => ({
  id,
  box: { x: pinned?.x ?? 0, y: pinned?.y ?? 0, w, h },
  order,
  ...(pinned ? { pinned: true } : {}),
});
const options = (raw: unknown): StackOptions => {
  const r = stackLayout.parseOptions(raw);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('stack layout (FR-DSL-005, ADR-0030)', () => {
  it('FR-DSL-005: stacked boxes never overlap and keep the gap, down from the padded top-left by default', () => {
    const out = stackLayout.run({ frame, nodes: [node('b', [200, 80], 2), node('a', [300, 100], 1), node('c', [100, 50], 3)] }, options({}));
    expect(out.boxes).toEqual({
      a: { x: 80, y: 80, w: 300, h: 100 },
      b: { x: 80, y: 204, w: 200, h: 80 },
      c: { x: 80, y: 308, w: 100, h: 50 },
    });
    const right = stackLayout.run(
      { frame, nodes: [node('a', [300, 100], 1), node('b', [200, 80], 2)] },
      options({ direction: 'right', gap: 10, padding: 0, align: 'center' }),
    );
    expect(right.boxes).toEqual({ a: { x: 0, y: 0, w: 300, h: 100 }, b: { x: 310, y: 10, w: 200, h: 80 } });
  });

  it('FR-DSL-005: a fractional size or pin edge with no gap rounds forward, so it neither overlaps nor loops', () => {
    const o = options({ gap: 0, padding: 0 });
    expect(stackLayout.run({ frame, nodes: [node('a', [10, 10.2], 1), node('b', [10, 10], 2)] }, o).boxes['b']).toEqual({ x: 0, y: 10.5, w: 10, h: 10 });
    const pin = node('p', [100, 100.2], 0, { x: 0, y: 0 });
    expect(stackLayout.run({ frame, nodes: [pin, node('a', [10, 10], 1)] }, o).boxes['a']).toEqual({ x: 0, y: 100.5, w: 10, h: 10 });
    // a hair past a half pixel still rounds forward (M12.12 review r2)
    const hair = node('p', [100, 100.0000000004], 0, { x: 0, y: 0 });
    expect(stackLayout.run({ frame, nodes: [hair, node('a', [10, 10], 1)] }, o).boxes['a']).toEqual({ x: 0, y: 100.5, w: 10, h: 10 });
    expect(stackLayout.run({ frame, nodes: [node('a', [10, 10.0000000004], 1), node('b', [10, 10], 2)] }, o).boxes['b']?.y).toBe(10.5);
  });

  it('FR-DSL-005: pinned boxes are not moved, and the stack steps past any it would overlap', () => {
    const pin = node('p', [400, 150], 0, { x: 60, y: 200 });
    const out = stackLayout.run({ frame, nodes: [node('a', [300, 100], 1), pin, node('b', [300, 100], 2)] }, options({}));
    expect(out.boxes['p']).toEqual(pin.box);
    expect(out.boxes['a']).toEqual({ x: 80, y: 80, w: 300, h: 100 });
    // b would land at y 204, inside the pin (200..350): it goes below the pin plus the gap
    expect(out.boxes['b']).toEqual({ x: 80, y: 374, w: 300, h: 100 });
  });

  it('FR-DSL-005: the same input gives the same boxes, whatever the node order, and no placed box overlaps another', () => {
    // fractional sizes and pins and gaps down to 0: rounding must never pull a box back over another (M12.12 review)
    const size = fc.double({ min: 0.1, max: 400, noNaN: true });
    const at = fc.double({ min: 0, max: 1500, noNaN: true });
    const arb = fc.array(fc.record({ w: size, h: size, pin: fc.option(fc.record({ x: at, y: at }), { nil: undefined }) }), { maxLength: 12 });
    fc.assert(
      fc.property(arb, fc.constantFrom('down', 'right'), fc.constantFrom(0, 0.1, 24), (specs, direction, gap) => {
        // pins that overlap each other are the author's; the stack only promises not to add overlaps
        const nodes = specs.map((s, i) => node(`n${i}`, [s.w, s.h], i, s.pin));
        const opts = options({ direction, gap, padding: 0 });
        const a = stackLayout.run({ frame, nodes }, opts);
        const b = stackLayout.run({ frame, nodes: [...nodes].reverse() }, opts);
        expect(b.boxes).toEqual(a.boxes);
        const placed = nodes.filter((n) => !n.pinned).map((n) => a.boxes[n.id]);
        const all = nodes.map((n) => a.boxes[n.id]);
        const clashes = placed.flatMap((p) => all.filter((q) => p !== q && p !== undefined && q !== undefined && overlaps(p, q)));
        expect(clashes).toEqual([]);
        expect(nodes.filter((n) => n.pinned).map((n) => a.boxes[n.id])).toEqual(nodes.filter((n) => n.pinned).map((n) => n.box));
      }),
    );
  });

  it('FR-DSL-005: options are checked, with a message naming the bad one', () => {
    expect(stackLayout.parseOptions(undefined)).toEqual({ ok: true, value: { direction: 'down', gap: 24, align: 'start', padding: 80, wrap: 0 } });
    for (const [raw, word] of [
      [{ direction: 'up' }, 'direction'],
      [{ gap: -1 }, 'gap'],
      [{ gap: 'wide' }, 'gap'],
      [{ align: 'middle' }, 'align'],
      [{ padding: Number.NaN }, 'padding'],
      [{ spacing: 4 }, 'spacing'],
      [[1], 'object'],
    ] as const) {
      const r = stackLayout.parseOptions(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.message).toContain(word);
    }
  });

  it('FR-DSL-005: the built-in layouts register in the layouts registry through the plugin API', () => {
    const registries = createCoreRegistries();
    const r = registerBuiltInLayouts(registries.layouts);
    expect(r.ok).toBe(true);
    const stack = registries.layouts.get('stack') as LayoutAlgorithm<StackOptions> | undefined;
    expect(stack?.id).toBe('stack');
    expect(registries.layouts.source('stack')).toBe('core');
    // a second call by the same source replaces its own entry
    expect(registerBuiltInLayouts(registries.layouts).ok).toBe(true);
  });

  it('FR-LAY-002: fixture stack-wrap starts a new line beside the first when a box would pass the wrap length', () => {
    const o = options({ gap: 10, padding: 0, wrap: 200 });
    const out = stackLayout.run({ frame, nodes: [node('a', [50, 100], 1), node('b', [60, 80], 2), node('c', [70, 60], 3)] }, o);
    // a and b fit in 190 px; c would reach 260, so it starts the next line, 60 + 10 px to the right of the first
    expect(out.boxes).toEqual({ a: { x: 0, y: 0, w: 50, h: 100 }, b: { x: 0, y: 110, w: 60, h: 80 }, c: { x: 70, y: 0, w: 70, h: 60 } });
    const row = stackLayout.run(
      { frame, nodes: [node('a', [100, 50], 1), node('b', [100, 50], 2), node('c', [100, 30], 3)] },
      options({ direction: 'right', gap: 0, padding: 0, wrap: 200, align: 'end' }),
    );
    expect(row.boxes).toEqual({ a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 100, y: 0, w: 100, h: 50 }, c: { x: 0, y: 50, w: 100, h: 30 } });
    // a box longer than the wrap length stays alone on its line; wrap 0 never wraps
    const tall = stackLayout.run({ frame, nodes: [node('a', [10, 500], 1), node('b', [10, 10], 2)] }, options({ gap: 0, padding: 0, wrap: 100 }));
    expect(tall.boxes['b']).toEqual({ x: 10, y: 0, w: 10, h: 10 });
    const flat = stackLayout.run({ frame, nodes: [node('a', [10, 500], 1), node('b', [10, 10], 2)] }, options({ gap: 0, padding: 0 }));
    expect(flat.boxes['b']).toEqual({ x: 0, y: 500, w: 10, h: 10 });
  });

  it('FR-LAY-002: wrapped lines never overlap for fractional sizes, gaps and alignments, and a pin may push a line past the wrap length', () => {
    const sizes: ReadonlyArray<readonly [number, number]> = [
      [10.2, 40.3],
      [7.7, 30.1],
      [9.4, 55.5],
      [10.2, 20.2],
      [3.3, 70.7],
    ];
    for (const align of ['start', 'center', 'end'] as const) {
      const nodes = sizes.map((s, i) => node(`n${i}`, s, i));
      const out = stackLayout.run({ frame, nodes }, options({ gap: 0.3, padding: 0.1, wrap: 100, align }));
      const boxes = nodes.map((n) => out.boxes[n.id] as { x: number; y: number; w: number; h: number });
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    // wrap counts sizes and gaps only: a pin in the middle of the first line pushes b, and so c, down to 150, past the wrap length of 130
    const pin = node('p', [50, 50], 0, { x: 0, y: 60 });
    const out = stackLayout.run(
      { frame, nodes: [pin, node('a', [10, 40], 1), node('b', [10, 40], 2), node('c', [10, 40], 3)] },
      options({ gap: 0, padding: 0, wrap: 130 }),
    );
    expect(out.boxes['p']).toEqual(pin.box);
    expect(out.boxes['c']?.y).toBe(150);
    expect(out.boxes['c']?.x).toBe(0);
  });
});
