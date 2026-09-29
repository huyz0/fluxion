import { createCoreRegistries, parseMarkerDef } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { basicPack } from './index.js';
import { basicMarkers } from './markers.js';

describe('basic pack markers (FR-CON-003, FR-EXT-001)', () => {
  it("FR-CON-003: the basic pack registers its open arrow and crow's-foot markers in its namespace", () => {
    expect(basicMarkers.map((m) => m.id)).toEqual([
      'basic:open-arrow',
      'basic:crows-foot-one',
      'basic:crows-foot-many',
      'basic:crows-foot-zero-one',
      'basic:crows-foot-zero-many',
    ]);
    // each is a valid marker: literal path data in its box, stroked as wide as the connector
    for (const def of basicMarkers) {
      expect(parseMarkerDef(def), def.id).toEqual({ ok: true, value: def });
      expect(def.filled, def.id).toBe(false);
    }
    // the ringed ones stop the route at the ring's back and draw their own line to the tip
    expect(basicMarkers.filter((m) => m.inset > 0).map((m) => [m.id, m.inset, m.path.includes('M4 5 L10 5')])).toEqual([
      ['basic:crows-foot-zero-one', 10, true],
      ['basic:crows-foot-zero-many', 10, true],
    ]);
    const registries = createCoreRegistries();
    expect(basicPack.register(registries).ok).toBe(true);
    expect(basicMarkers.map((m) => [registries.markers.get(m.id), registries.markers.source(m.id)])).toEqual(basicMarkers.map((m) => [m, 'basic']));
  });
});
