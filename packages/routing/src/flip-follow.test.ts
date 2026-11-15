// FR-SHP-009: a connector bound to a flipped element's named anchor follows the flip (M19.16): `element.flip` toggles `flipX`,
// the `e` anchor is placed through the element's matrix, so the route now leaves from the west side, and undo puts it back.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import type { Router } from './router.js';

function context(): RouteContext {
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
}

describe('a bound connector follows a flip (FR-SHP-009)', () => {
  it("FR-SHP-009: a connector bound to a rect's e anchor leaves from its west side once the rect is flipped horizontally", () => {
    const b = documentBuilder({ seed: 19161 });
    const s = b.screen();
    const rect = b.rect(s, { x: 0, y: 0, w: 100, h: 100 });
    const line = b.connect(rect, { x: 300, y: 50 }, { sourceAnchor: { kind: 'named', name: 'e' } });
    const core = createCore(b.build() as DocumentFile);
    const ctx = context();
    const source = () => core.store.query((view) => routeConnector(view, ctx, line))()?.source.point;
    expect(source()).toEqual({ x: 100, y: 50 });
    expect(core.execute('element.flip', { ids: [rect], axis: 'x' }).ok).toBe(true);
    expect(source()).toEqual({ x: 0, y: 50 });
    core.store.history.undo();
    expect(source()).toEqual({ x: 100, y: 50 });
  });
});
