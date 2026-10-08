// The lenient fix loop's cost (M12.14 review F1): an error no removal fixes is tried once, not again after every later fix.
import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import * as schema from '@fluxion/schema';
import { describe, expect, it, vi } from 'vitest';
import { compile } from '../compile.js';
import { validateFlux } from './validate.js';

// count the schema validations the stage runs, keeping the real validate
vi.mock('@fluxion/schema', async (original) => {
  const real = await original<typeof import('@fluxion/schema')>();
  return { ...real, validate: vi.fn(real.validate) };
});

function registries() {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
}

/** `n` screens, each with a background lenient mode removes and a negative pinned width it cannot fix. */
const deck = (n: number) =>
  `flux: 1\ntitle: t\nuses: [basic]\nscreens:\n${Array.from(
    { length: n },
    (_, i) => `  - id: s${i}\n    background: notacolor\n    nodes:\n      n${i}: { shape: rect, pin: { x: 0, y: 0, w: -5, h: 10 } }\n`,
  ).join('')}`;

describe('validate stage, lenient', () => {
  it('FR-DSL-006: a deck with many unfixable and many fixable errors validates a number of times linear in its errors', () => {
    const n = 12;
    const strict = compile(deck(n), { registries: registries() });
    const records = strict.doc?.records ?? {};
    const calls = vi.mocked(schema.validate);
    calls.mockClear();
    const r = validateFlux({ records, sourceMap: new Map() }, { mode: 'lenient' });
    // every background removed, every negative width still an error
    expect(r.diagnostics.filter((d) => d.severity === 'warning' && d.message.includes('/background'))).toHaveLength(n);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(n);
    // the first validation, then at most one try per path depth for each error (depth ≤ 4 here), each error tried once
    expect(calls.mock.calls.length).toBeLessThanOrEqual(1 + 2 * n * 4);
  });
});
