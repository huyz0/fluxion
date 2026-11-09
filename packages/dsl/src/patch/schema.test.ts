// FR-AI-001 / FR-AI-003: the patch schema is checked against its published JSON Schema directly, so a
// dropped op, field, keyword, bound, pattern or description changes a verdict in this file.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aiPatchSchema, EDGE_SET_KEYS, MAX_PATCH_OPS, NODE_SPEC_KEYS } from './schema.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const published = JSON.parse(
  Object.values(import.meta.glob('../../../../specs/schema/ai-patch.schema.json', { query: '?raw', import: 'default', eager: true }))[0] ?? 'null',
);
const ok = (patch: unknown) => aiPatchSchema.safeParse(patch).success;
const one = (op: Record<string, unknown>) => ({ flux: 1, ops: [op] });

describe('the AI patch schema', () => {
  it('FR-AI-001: it is exactly the published JSON Schema', () => {
    expect(published).not.toBeNull();
    expect({ title: 'Fluxion AI patch', ...z.toJSONSchema(aiPatchSchema, { unrepresentable: 'any', io: 'input' }) }).toEqual(published);
  });

  it('FR-AI-003: the node and edge keys are the reader vocabulary', () => {
    expect(NODE_SPEC_KEYS).toEqual(['shape', 'text', 'label', 'tone', 'style', 'pin', 'alt']);
    expect(EDGE_SET_KEYS).toEqual(['label', 'style', 'route', 'jumps']);
    expect(MAX_PATCH_OPS).toBe(200);
  });

  it('FR-AI-003: a patch holds one to MAX_PATCH_OPS ops, and an optional r<N> base revision', () => {
    const remove = { op: 'remove', target: 'a' };
    expect(ok({ flux: 1, ops: Array(MAX_PATCH_OPS).fill(remove) })).toBe(true);
    expect(ok({ flux: 1, ops: Array(MAX_PATCH_OPS + 1).fill(remove) })).toBe(false);
    expect(ok({ flux: 1, ops: [] })).toBe(false);
    expect(ok({ flux: 2, ops: [remove] })).toBe(false);
    expect(ok({ flux: 1, baseRevision: 'r12', ops: [remove] })).toBe(true);
    for (const bad of ['12', 'r', 'xr1', 'r1x', 'R1']) expect(ok({ flux: 1, baseRevision: bad, ops: [remove] }), bad).toBe(false);
    expect(ok({ flux: 1, ops: [remove], extra: 1 })).toBe(false);
  });

  it('FR-AI-003: each of the nine ops takes its own fields and refuses others', () => {
    const node = { shape: 'rect', text: 't', label: 'l', tone: 'accent', style: { fill: 'c' }, pin: { x: 0, y: 0, w: 1, h: 1 }, alt: 'a' };
    const good = [
      { op: 'add', screen: 's', slug: 'a-1', node, parent: 'p' },
      { op: 'update', target: 'a', set: { label: 'x' } },
      { op: 'update', target: 'a->b', set: { jumps: 'default', route: 'curved' } },
      { op: 'remove', target: 'a', cascade: true },
      { op: 'connect', edge: 'a -> b', spec: { label: 'l', style: {}, route: 'orthogonal', jumps: 'gap' } },
      { op: 'disconnect', target: 'a->b' },
      { op: 'setLayout', scope: 's', layout: { type: 'grid', columns: 2, gap: 0, align: 'center' }, relayout: true },
      { op: 'restyle', targets: ['a', 'b'], style: { fill: 'c' } },
      { op: 'restyle', targets: { select: { screen: 's', shape: 'rect', tone: 't', kind: 'shape' } }, style: {} },
      { op: 'addStep', screen: 's', at: 0, step: { label: 'l', reveal: ['a'] } },
      { op: 'addStep', screen: 's', at: 'end', step: {} },
      { op: 'addInteraction', owner: 'a', rule: { on: 'hover', do: 'step', to: '2' } },
    ];
    for (const op of good) {
      expect(ok(one(op)), JSON.stringify(op)).toBe(true);
      expect(ok(one({ ...op, extra: 1 })), `${op.op} extra`).toBe(false);
    }
    for (const bad of [
      { op: 'add', screen: 's', slug: 'A', node: {} },
      { op: 'add', screen: 's', slug: '1a', node: {} },
      { op: 'add', screen: 's', slug: 'a!', node: {} },
      { op: 'add', screen: '', slug: 'a', node: {} },
      { op: 'add', screen: 's', slug: 'a', node: { pin: { x: 0, y: 0, w: 0 } } },
      { op: 'add', screen: 's', slug: 'a', node: { pin: { x: 0, y: 0, h: 0 } } },
      { op: 'add', screen: 's', slug: 'a', node: { pin: { x: 0 } } },
      { op: 'add', screen: 's', slug: 'a', node: { style: { fill: 1 } } },
      { op: 'update', target: 'a', set: { jumps: 'always' } },
      { op: 'connect', edge: '' },
      { op: 'connect', edge: 'a -> b', spec: { jumps: 'default' } },
      { op: 'connect', edge: 'a -> b', spec: { route: 'zigzag' } },
      { op: 'restyle', targets: [], style: {} },
      { op: 'addStep', screen: 's', at: -1, step: {} },
      { op: 'addStep', screen: 's', at: 1.5, step: {} },
      { op: 'addStep', screen: 's', at: 'start', step: {} },
      { op: 'addInteraction', owner: 'a', rule: { on: 'press', do: 'goto', to: 'x' } },
      { op: 'addInteraction', owner: 'a', rule: { on: 'click', do: 'open', to: 'x' } },
      { op: 'rename', target: 'a' },
    ])
      expect(ok(one(bad)), JSON.stringify(bad)).toBe(false);
  });

  it('FR-AI-003: a layout intent takes its keywords and non-negative bounds', () => {
    const layout = (l: Record<string, unknown>) => ok(one({ op: 'setLayout', scope: 's', layout: { type: 'layered', ...l } }));
    for (const direction of ['down', 'right', 'up', 'left']) expect(layout({ direction }), direction).toBe(true);
    for (const spacing of ['compact', 'comfortable', 'spacious']) expect(layout({ spacing }), spacing).toBe(true);
    for (const align of ['start', 'center', 'end']) expect(layout({ align }), align).toBe(true);
    expect(layout({ nodeGap: 0, rankGap: 0, gap: 0, padding: 0, wrap: 0, columns: 1, id: 'process.basic', options: { a: 1 } })).toBe(true);
    expect(layout({ items: ['a', { label: 'b', detail: 'd', children: ['c', { label: 'e', detail: 'f' }] }] })).toBe(true);
    for (const bad of [
      { direction: 'diagonal' },
      { spacing: 'tight' },
      { align: 'middle' },
      { nodeGap: -1 },
      { rankGap: -1 },
      { gap: -1 },
      { padding: -1 },
      { wrap: -1 },
      { columns: 0 },
      { columns: 1.5 },
      { items: [{ detail: 'd' }] },
      { items: [{ label: 'a', children: [{ label: 'b', children: [] }] }] },
      { extra: 1 },
    ])
      expect(layout(bad), JSON.stringify(bad)).toBe(false);
  });
});
