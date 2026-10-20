// Settled routes (FR-RTE-003, M16.28): the views run the global pass a host hands over, once it has it, and otherwise draw what they did.
import { createStore, writable } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import { type GlobalRouteInput, globalRoutes } from '@fluxion/routing';
import type { DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import type { GlobalPass } from './registries.js';
import { withSettledRoutes } from './settled-routes.js';
import { testRegistries } from './test-registries.js';

/** An orthogonal connector whose cheap route crosses a wall between its ends, on one screen, and an empty second screen. */
function walled() {
  const b = documentBuilder({ seed: 2816 });
  const screen = b.screen();
  b.screen();
  const a = b.rect(screen, { x: 0, y: 200, w: 100, h: 80 });
  const wall = b.rect(screen, { x: 300, y: 0, w: 40, h: 500 });
  const c = b.rect(screen, { x: 600, y: 200, w: 100, h: 80 });
  const line = b.connect(a, c, { route: 'orthogonal' });
  return { store: createStore(b.build() as DocumentFile), line, wall };
}

describe('settled routes (FR-RTE-003)', () => {
  it('FR-RTE-003: registries with no pass, or with an overlay of their own, are returned as they are', () => {
    const { store } = walled();
    const plain = testRegistries();
    expect(withSettledRoutes(store, plain)).toBe(plain);
    const overlay = { ...plain, refined: () => new Map<string, readonly PathCommand[]>(), globalPass: () => globalRoutes };
    expect(withSettledRoutes(store, overlay)).toBe(overlay);
  });

  it('FR-RTE-003: the views run the pass once it arrives, one call per screen with connectors, and keep the map while nothing moves', () => {
    const { store, line } = walled();
    const pass = writable<GlobalPass | undefined>(undefined);
    const inputs: GlobalRouteInput[] = [];
    const counted: GlobalPass = (input) => {
      inputs.push(input);
      return globalRoutes(input);
    };
    const registries = { ...testRegistries(), globalPass: pass.get };
    const settled = withSettledRoutes(store, registries);
    // the same registries for the same store: views share the queries
    expect(withSettledRoutes(store, registries)).toBe(settled);
    const refined = settled.refined;
    expect(refined).toBeDefined();
    // before the pass arrives: no overlay, the cheap routes are drawn
    expect(store.query(() => refined?.())()).toBeUndefined();
    pass.set(counted);
    const routes = store.query(() => refined?.());
    const first = routes();
    expect([...(first?.keys() ?? [])]).toEqual([line]);
    // around the wall: more than the three segments of the cheap elbow
    expect((first?.get(line)?.length ?? 0) > 4).toBe(true);
    expect(inputs).toHaveLength(1);
    expect(routes()).toBe(first);
  });
});
