import { createCoreRegistries, evaluateOutline } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { basicPack, rect, VERSION } from './index.js';

it('NFR-MNT-004 smoke: @fluxion/pack-basic exports its version', () => {
  expect(VERSION).toBe('0.0.0');
});

describe('basic pack (FR-SHP-002)', () => {
  it('FR-EXT-001: the basic pack registers its shapes under the basic namespace', () => {
    const registries = createCoreRegistries();
    const r = basicPack.register(registries);
    expect(r.ok ? [] : r.error).toEqual([]);
    expect(registries.shapeDefs.get('basic:rect')).toEqual(rect);
    expect(registries.shapeDefs.source('basic:rect')).toBe('basic');
    expect(basicPack.shapes.every((s) => s.id.startsWith('basic:'))).toBe(true);
  });

  it('FR-SHP-002: basic:rect is the box, clockwise from the top-left corner', () => {
    const o = evaluateOutline(rect, { w: 120, h: 80 });
    expect(o.ok ? o.value.commands : o.error).toEqual([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 120, y: 0 } },
      { kind: 'L', to: { x: 120, y: 80 } },
      { kind: 'L', to: { x: 0, y: 80 } },
      { kind: 'Z' },
    ]);
  });
});
