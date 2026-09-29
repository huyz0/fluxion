import { createCoreRegistries } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { renderRegistriesFor } from './registries.js';

describe('render registries of a host (ADR-0017)', () => {
  it("FR-EDT-001: a host's render registries draw the shapes and markers its packs registered", () => {
    const host = createCoreRegistries();
    const star = { id: 'demo:star', outline: { path: 'M 0 0 L {w} {h}' }, defaultSize: { w: 10, h: 10 } };
    const open = { id: 'demo:open', path: 'M0 0 L10 5 L0 10', inset: 0, filled: false };
    host.shapeDefs.register(star.id, star as never, 'demo');
    host.markers.register(open.id, open, 'demo');
    const r = renderRegistriesFor(host);
    expect([r.shapeDefs, r.markers]).toEqual([host.shapeDefs, host.markers]);
    // the built-ins come with them
    expect(r.elementViews.source('shape')).toBe('core');
    expect([r.markers.get('arrow')?.id, r.routers.get('orthogonal') !== undefined]).toEqual(['arrow', true]);
  });
});
