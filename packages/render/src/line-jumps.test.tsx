// FR-CON-008: where two connectors cross, the one painted later draws a hop, in its own `route.jumps` style or else the document's
// (`settings.lineJumps`: arcs when on, none when off); a route with curves is crossed but does not hop.
import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId, Route } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { hopsOfConnector, lineJumps } from './line-jumps.js';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';

type Rec = { readonly type?: unknown; readonly id?: string; readonly route?: Route; readonly settings?: object };

/** A horizontal connector (0, 100) to (200, 100), then a vertical one (100, 0) to (100, 200) painted after it, crossing at (100, 100). */
function crossing(options: { readonly lineJumps?: boolean; readonly horizontal?: Partial<Route>; readonly vertical?: Partial<Route> } = {}) {
  const b = documentBuilder({ seed: 1621 });
  const screen = b.screen({ size: { w: 400, h: 300 } });
  const horizontal = b.connect({ x: 0, y: 100 }, { x: 200, y: 100 }, { arrow: false });
  const vertical = b.connect({ x: 100, y: 0 }, { x: 100, y: 200 }, { arrow: false });
  const file = b.build();
  const records = { ...file.records } as Record<string, Rec>;
  const withRoute = (id: RecordId, route: Partial<Route> | undefined) => {
    if (route !== undefined) records[id] = { ...records[id], route: { ...(records[id]?.route as Route), ...route } };
  };
  withRoute(horizontal, options.horizontal);
  withRoute(vertical, options.vertical);
  if (options.lineJumps !== undefined) {
    const doc = Object.values(records).find((r) => r.type === 'document') as Rec;
    records[doc.id as string] = { ...doc, settings: { ...doc.settings, lineJumps: options.lineJumps } };
  }
  return { file: { ...file, records } as DocumentFile, horizontal, vertical, screen };
}

/** The `d` of each connector's stroke in the static HTML, in painting order. */
function strokes(file: DocumentFile): string[] {
  const html = renderDocumentToHtml(file, { registries: testRegistries() }).html;
  return [...html.matchAll(/<path class="fx-route" d="([^"]*)"/g)].map((m) => m[1] as string);
}

describe('line jumps (FR-CON-008)', () => {
  it('FR-CON-008: with the document setting on, the connector painted later arcs over the crossing and the other stays straight', () => {
    const [horizontal, vertical] = strokes(crossing({ lineJumps: true }).file);
    expect(horizontal).toBe('M0 100 L200 100');
    // down to 6 above the crossing, an arc (one cubic) to 6 below it, on down
    expect(vertical).toMatch(/^M100 0 L100 94 C[\d.]+ 94 [\d.]+ 106 100 106 L100 200$/);
  });

  it('FR-CON-008: with the setting off or absent, nothing hops; a connector own style still does, as an arc or a gap', () => {
    expect(strokes(crossing().file)).toEqual(['M0 100 L200 100', 'M100 0 L100 200']);
    expect(strokes(crossing({ lineJumps: false }).file)).toEqual(['M0 100 L200 100', 'M100 0 L100 200']);
    // the gap: the line stops 6 before the crossing and starts again 6 after it
    expect(strokes(crossing({ vertical: { jumps: 'gap' } }).file)[1]).toBe('M100 0 L100 94 M100 106 L100 200');
    // the lower connector's style does not make the upper one hop
    expect(strokes(crossing({ horizontal: { jumps: 'arc' } }).file)).toEqual(['M0 100 L200 100', 'M100 0 L100 200']);
    // and a connector's `none` turns the document's arcs off for it
    expect(strokes(crossing({ lineJumps: true, vertical: { jumps: 'none' } }).file)[1]).toBe('M100 0 L100 200');
  });

  it('FR-CON-008: a curved route does not hop, but a straight one painted after it hops over it', () => {
    const curvedOnTop = strokes(crossing({ lineJumps: true, vertical: { type: 'curved', waypoints: [{ x: 120, y: 100 }] } }).file);
    expect(curvedOnTop[0]).toBe('M0 100 L200 100');
    expect(curvedOnTop[1]).not.toContain('L100 94');
    const straightOnTop = strokes(crossing({ lineJumps: true, horizontal: { type: 'curved', waypoints: [{ x: 90, y: 130 }] } }).file);
    expect(straightOnTop[1]).toMatch(/ C/);
  });

  it('FR-CON-008: the hops query keeps one empty map while nothing hops, and one query per store and context', () => {
    const { file, vertical } = crossing();
    const core = createCore(file);
    const ctx = testRegistries();
    const hops = lineJumps(core.store, ctx);
    expect(lineJumps(core.store, ctx)).toBe(hops);
    const empty = hops();
    expect(empty.size).toBe(0);
    // a change that turns nothing on keeps the same map, so no connector view redraws for it
    core.store.transact('move', (tx) => tx.patch(vertical, { freeSource: { x: 110, y: 0 } }));
    expect(hops()).toBe(empty);
    core.store.transact('gap', (tx) => tx.patch(vertical, { route: { type: 'straight', jumps: 'gap' } }));
    expect(hops().get(vertical)).toMatchObject({ style: 'gap', jumps: [{ segment: 0 }] });
  });

  it('FR-CON-008: while hops are drawn, a change that leaves a connector hops as they were keeps its entry, so its view does not redraw', () => {
    const { file, horizontal, vertical } = crossing({ lineJumps: true });
    const core = createCore(file);
    const ctx = testRegistries();
    const own = hopsOfConnector(core.store, ctx, vertical);
    const before = own();
    expect(before?.jumps).toMatchObject([{ segment: 0, over: horizontal }]);
    // the horizontal connector moves along itself: the crossing stays where it was
    core.store.transact('slide', (tx) => tx.patch(horizontal, { freeSource: { x: -20, y: 100 } }));
    expect(own()).toBe(before);
    // moved off the vertical one, the hop goes
    core.store.transact('away', (tx) => tx.patch(horizontal, { freeSource: { x: 300, y: 100 }, freeTarget: { x: 380, y: 100 } }));
    expect(own()).toBeUndefined();
  });
});
