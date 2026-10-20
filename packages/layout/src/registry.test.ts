// FR-LAY-001: layouts are pluggable by name with typed options and one interface.
import { createRegistry } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { layoutOptionsJsonSchema, listLayouts, registerBuiltInLayouts, registerLayout, stackLayout } from './index.js';
import type { LayoutAlgorithm } from './types.js';

const ring: LayoutAlgorithm<{ radius: number }> = {
  id: 'test:ring',
  version: '2',
  schema: z.strictObject({ radius: z.number().min(1).default(100) }).default({ radius: 100 }),
  capabilities: { pins: false, compound: false, runsIn: 'main' },
  parseOptions: (raw) => ({ ok: true, value: { radius: Number((raw as { radius?: number } | undefined)?.radius ?? 100) } }),
  run: (input) => ({ boxes: Object.fromEntries(input.nodes.map((n) => [n.id, n.box])) }),
};

const layouts = () => createRegistry<string, unknown>('layouts');

describe('layout registry (FR-LAY-001)', () => {
  it('FR-LAY-001: a registered layout is listed with its id, version and options schema', () => {
    const r = layouts();
    registerBuiltInLayouts(r);
    expect(registerLayout(r, ring, 'test')).toEqual({ ok: true });
    expect(listLayouts(r).map((a) => [a.id, a.version])).toEqual([
      ['grid', '1'],
      ['layered', '1'],
      ['mindmap', '1'],
      ['orgchart', '1'],
      ['radial', '1'],
      ['stack', '2'],
      ['test:ring', '2'],
      ['tree', '1'],
    ]);
    expect(listLayouts(r)[6]?.schema.safeParse({ radius: 0 }).success).toBe(false);
  });

  it('FR-LAY-001: a value without an options schema, capabilities, run or parseOptions is refused at registration', () => {
    const r = layouts();
    for (const missing of ['schema', 'capabilities', 'run', 'parseOptions', 'version', 'id'] as const) {
      const broken = { ...ring, [missing]: undefined } as unknown as LayoutAlgorithm<{ radius: number }>;
      const result = registerLayout(r, broken, 'test');
      expect(result.ok).toBe(false);
    }
    for (const capabilities of [{}, { pins: true, compound: false, runsIn: 'gpu' }, { pins: 1, compound: false, runsIn: 'main' }]) {
      expect(registerLayout(r, { ...ring, capabilities } as unknown as LayoutAlgorithm<{ radius: number }>, 'test').ok).toBe(false);
    }
    expect(r.list()).toEqual([]);
    // a second source cannot take a name
    expect(registerLayout(r, ring, 'a')).toEqual({ ok: true });
    expect(registerLayout(r, ring, 'b').ok).toBe(false);
  });

  it('FR-LAY-001: the options schema of stack agrees with parseOptions on defaults and on refusals', () => {
    const defaults = stackLayout.parseOptions(undefined);
    expect(defaults.ok && stackLayout.schema.parse(undefined)).toEqual(defaults.ok ? defaults.value : null);
    // an option set to undefined is absent in both readings
    const bare = stackLayout.parseOptions({ gap: undefined });
    expect(bare.ok && stackLayout.schema.parse({ gap: undefined })).toEqual(bare.ok ? bare.value : null);
    for (const raw of [{ gap: -1 }, { direction: 'up' }, { align: 'middle' }, { padding: Number.NaN }, { colour: 'red' }]) {
      expect(stackLayout.parseOptions(raw).ok).toBe(false);
      expect(stackLayout.schema.safeParse(raw).success).toBe(false);
    }
    const some = { direction: 'right', gap: 8 } as const;
    const parsed = stackLayout.parseOptions(some);
    expect(parsed.ok && stackLayout.schema.parse(some)).toEqual(parsed.ok ? parsed.value : null);
  });

  it('FR-LAY-001: the options of a layout are published as JSON Schema', () => {
    const json = layoutOptionsJsonSchema(stackLayout) as { properties?: Record<string, { enum?: string[]; type?: string }> };
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['align', 'direction', 'gap', 'padding', 'wrap']);
    expect(json.properties?.['direction']?.enum).toEqual(['down', 'right']);
    expect(json.properties?.['gap']?.type).toBe('number');
  });
});
