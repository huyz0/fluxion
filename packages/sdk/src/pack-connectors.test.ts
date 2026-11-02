import { describe, expect, it } from 'vitest';
import { loadPackConnectors } from './pack-connectors.js';

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const FILE = {
  format: 'fluxion-connector-defs',
  formatVersion: '1.0',
  definitions: [{ id: 'lines:pipe', router: 'orthogonal', decoration: { kind: 'pipe', wall: 2 }, name: 'Pipe' }],
};

describe('pack connectors.json loading (FR-CON-010)', () => {
  it('FR-CON-010: a valid connectors.json loads as frozen connector definitions', () => {
    const loaded = loadPackConnectors(bytes(FILE), 'lines', 1 << 20);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.map((d) => d.id)).toEqual(['lines:pipe']);
    expect(Object.isFrozen(loaded.value[0]?.decoration)).toBe(true);
  });

  it('FR-CON-010: a file over the cap, not UTF-8 JSON or not a valid envelope is refused whole with FLX_PACK_INVALID', () => {
    const cases: [Uint8Array, number][] = [
      [bytes(FILE), 10],
      [new Uint8Array([0x7b, 0xff, 0x7d]), 1 << 20],
      [bytes('{"format":'), 1 << 20],
      [bytes({ ...FILE, definitions: [...FILE.definitions, { ...FILE.definitions[0], id: 'other:pipe' }] }), 1 << 20],
      [bytes({ ...FILE, definitions: [{ ...FILE.definitions[0], decoration: { kind: 'pipe', wall: 0 } }] }), 1 << 20],
      [bytes(FILE), 0],
    ];
    for (const [input, cap] of cases) {
      const r = loadPackConnectors(input, 'lines', cap);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length > 0 && r.error.every((d) => d.code === 'FLX_PACK_INVALID')).toBe(true);
    }
  });
});
