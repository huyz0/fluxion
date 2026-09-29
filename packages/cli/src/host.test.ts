import { definePack, type ShapeDef } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { BUNDLED_PACKS, hostRegistries } from './host.js';

describe('CLI host (ADR-0017)', () => {
  it('FR-EXT-001: the CLI registers the basic pack into its core registries', () => {
    const { registries, problems } = hostRegistries();
    expect(problems).toEqual([]);
    expect(BUNDLED_PACKS.map((p) => p.id)).toEqual(['basic']);
    expect(registries.shapeDefs.get('basic:rect')?.id).toBe('basic:rect');
    expect(registries.shapeDefs.source('basic:rect')).toBe('basic');
  });

  it('reports every pack that fails to register, naming it, and keeps the others', () => {
    const broken = definePack({ id: 'broken', shapes: [{ id: 'broken:x' } as unknown as ShapeDef] });
    const fine = definePack({ id: 'fine', shapes: [{ id: 'fine:y', outline: { path: 'M 0 0' }, defaultSize: { w: 1, h: 1 } }] });
    const { registries, problems } = hostRegistries([broken, fine]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((d) => d.message.startsWith('pack "broken": '))).toBe(true);
    expect(registries.shapeDefs.get('fine:y')).toBeDefined();
    expect(registries.shapeDefs.get('broken:x')).toBeUndefined();
  });
});
