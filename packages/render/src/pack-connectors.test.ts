import { type ConnectorDef, createCore, parseConnectorDefs } from '@fluxion/core';
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import { connectorDefRouter, decorateRoute, globalRouteInput, routeConnector, routerBase, trimRoute } from '@fluxion/routing';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_DEFS as defs } from './__fixtures__/connector-defs.js';
import { normalizeSvg } from './golden.js';
import type { RenderRegistries } from './registries.js';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';

const KINDS = ['wavy', 'zigzag', 'double', 'pipe', 'cable'] as const;

/** The test registries with the fixture pack's connector types registered as routers. */
function registries(): { readonly registries: RenderRegistries; readonly parsed: readonly ConnectorDef[] } {
  const r = testRegistries();
  const parsed = parseConnectorDefs(defs, 'lines');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  for (const def of parsed.value) {
    const router = connectorDefRouter(def, r.routers);
    if (router === undefined) throw new Error(`no ${def.router} router`);
    r.routers.register(def.id, router, 'lines');
  }
  return { registries: r, parsed: parsed.value };
}

/** Two shapes offset so the orthogonal router bends, joined by one connector of `type` bound to their sides. */
function joined(type: `${string}:${string}` | 'orthogonal'): { readonly file: DocumentFile; readonly line: RecordId } {
  const b = documentBuilder({ seed: 138 });
  const screen = b.screen({ size: { w: 400, h: 240 } });
  const a = b.rect(screen, { x: 20, y: 20, w: 80, h: 50 });
  const c = b.rect(screen, { x: 280, y: 160, w: 80, h: 50 });
  const line = b.connect(a, c, { route: type, sourceAnchor: { kind: 'side', side: 'e' }, targetAnchor: { kind: 'side', side: 'w' } });
  return { file: b.build(), line };
}

const ends = (commands: readonly PathCommand[]): [Vec2, Vec2] => {
  const pts = commands.map((c) => (c as { to: Vec2 }).to);
  return [pts[0] as Vec2, pts.at(-1) as Vec2];
};

describe('pack connector types (FR-CON-010)', () => {
  it('FR-CON-010: a pack connector file parses five types; a foreign namespace, a duplicate, code and an unknown decoration are refused', () => {
    expect(registries().parsed.map((d) => d.decoration.kind)).toEqual([...KINDS]);
    const bad = (definitions: unknown[]) => parseConnectorDefs({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions }, 'lines');
    const wavy = defs.definitions[0];
    for (const definitions of [
      [{ ...wavy, id: 'other:wavy' }],
      [wavy, wavy],
      [{ ...wavy, decoration: { kind: 'spiral', turns: 3 } }],
      [{ ...wavy, generate: 'return path' }],
      [{ ...wavy, decoration: { kind: 'wavy', amplitude: -1, wavelength: 12 } }],
    ]) {
      const r = bad(definitions);
      expect(r.ok ? [] : r.error.map((d) => d.code)).toContain('FLX_PACK_INVALID');
    }
  });

  it('FR-CON-010: WHEN a custom connector decorates orthogonal router output THE SYSTEM SHALL keep its bindings and route, and draw all five types to nonempty goldens', async () => {
    const { registries: r } = registries();
    const plainDoc = joined('orthogonal');
    const plain = routeConnector(createCore(plainDoc.file).store, { shapeDefs: r.shapeDefs, routers: r.routers }, plainDoc.line);
    expect(plain).toBeDefined();
    for (const kind of KINDS) {
      const { file, line } = joined(`lines:${kind}`);
      const { store } = createCore(file);
      expect(routerBase(r.routers, `lines:${kind}`)).toBe('orthogonal');
      // the same bound ends and the same orthogonal route as a plain orthogonal connector
      const routed = routeConnector(store, { shapeDefs: r.shapeDefs, routers: r.routers }, line);
      expect(routed?.commands).toEqual(plain?.commands);
      expect(store.members('byType', 'binding')).toHaveLength(2);
      // the global orthogonal pass routes it too
      const screen = store.members('byType', 'screen')[0] as RecordId;
      expect(globalRouteInput(store, { shapeDefs: r.shapeDefs, routers: r.routers }, screen).connectors.map((c) => c.id)).toEqual([line]);
      const svg = normalizeSvg(renderDocumentToHtml(file, { registries: r }).html);
      expect(svg).toContain(`data-decorated="${kind}"`);
      const strokes = [...svg.matchAll(/class="fx-route-decoration"[^>]*\sd="([^"]+)"/g)].map((m) => m[1] as string);
      expect(strokes.length, kind).toBeGreaterThan(0);
      for (const d of strokes) expect(d.length, kind).toBeGreaterThan(10);
      await expect(svg, kind).toMatchFileSnapshot(`../__golden__/pack-connector-${kind}.svg`);
    }
  });

  it('FR-CON-010, FR-CON-011: parallel connectors of a pack type fan apart as their base router does', () => {
    const { registries: r } = registries();
    const ctx = { shapeDefs: r.shapeDefs, routers: r.routers };
    const pair = (type: `${string}:${string}` | 'orthogonal') => {
      const b = documentBuilder({ seed: 138 });
      const screen = b.screen({ size: { w: 400, h: 240 } });
      const a = b.rect(screen, { x: 20, y: 20, w: 80, h: 50 });
      const c = b.rect(screen, { x: 280, y: 160, w: 80, h: 50 });
      const lines = [b.connect(a, c, { route: type }), b.connect(a, c, { route: type })];
      const { store } = createCore(b.build());
      return lines.map((line) => routeConnector(store, ctx, line)?.commands);
    };
    const [first, second] = pair('lines:double');
    expect(first).not.toEqual(second);
    expect([first, second]).toEqual(pair('orthogonal'));
  });

  it('FR-CON-010: waves and zigzags meet the route at both ends; double, pipe and cable follow it', () => {
    const route: PathCommand[] = [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 100, y: 0 } },
      { kind: 'L', to: { x: 100, y: 60 } },
    ];
    const trimmed = trimRoute(route, 0, 0).commands;
    for (const decoration of [
      { kind: 'wavy', amplitude: 3, wavelength: 12 },
      { kind: 'zigzag', amplitude: 3, wavelength: 8 },
    ] as const) {
      const [stroke] = decorateRoute(trimmed, decoration, 2);
      const [first, last] = ends(stroke?.commands ?? []);
      expect(first).toEqual({ x: 0, y: 0 });
      expect(last.x).toBeCloseTo(100, 6);
      expect(last.y).toBeCloseTo(60, 6);
      // it leaves the route by up to the amplitude (in stroke widths) between the ends
      // on the first leg, short of where its bend is rounded
      const ys = (stroke?.commands ?? [])
        .map((c) => (c as { to: Vec2 }).to)
        .filter((p) => p.x > 0 && p.x < 70)
        .map((p) => Math.abs(p.y));
      expect(Math.max(...ys)).toBeGreaterThan(1);
      expect(Math.max(...ys)).toBeLessThanOrEqual(6 + 1e-9);
    }
    // a polyline's two lines are offset exactly, mitred at its bend (no spur, no cut corner)
    const double = decorateRoute(trimmed, { kind: 'double', gap: 3 }, 2);
    expect(double.map((s) => s.commands.map((c) => (c as { to: Vec2 }).to))).toEqual([
      [
        { x: 0, y: 3 },
        { x: 97, y: 3 },
        { x: 97, y: 60 },
      ],
      [
        { x: 0, y: -3 },
        { x: 103, y: -3 },
        { x: 103, y: 60 },
      ],
    ]);
    expect(decorateRoute(trimmed, { kind: 'pipe', wall: 1.5 }, 2).map((s) => [s.part, s.width])).toEqual([
      ['line', 8],
      ['core', 2],
    ]);
    const cable = decorateRoute(trimmed, { kind: 'cable', pitch: 10 }, 2);
    expect(cable.map((s) => s.part)).toEqual(['line', 'tie']);
    // ties every 20 px along 160 px, none at the ends: 7 ties of two points each
    expect(cable[1]?.commands).toHaveLength(14);
    // a route of no length is drawn as it is
    expect(decorateRoute([{ kind: 'M', to: { x: 1, y: 1 } }], { kind: 'wavy', amplitude: 3, wavelength: 12 }, 2)).toEqual([
      { commands: [{ kind: 'M', to: { x: 1, y: 1 } }], width: 2, part: 'line' },
    ]);
  });

  it("FR-CON-010: WHEN a wavy or zigzag connector turns an orthogonal bend THE SYSTEM SHALL draw it without a hook or chamfer, and size a wide pipe's box to its walls", () => {
    const bend = trimRoute(
      [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 100, y: 0 } },
        { kind: 'L', to: { x: 100, y: 60 } },
      ],
      0,
      0,
    ).commands;
    const pointsOf = (commands: readonly PathCommand[]) => commands.map((c) => (c as { to: Vec2 }).to);
    // a wave turns gently all along, the bends included (a hook folds it back on itself): an L, and Z routes whose middle
    // jog is too short to round to the wave's full height
    const sharpest = (commands: readonly PathCommand[]) => {
      const wave = pointsOf(decorateRoute(commands, { kind: 'wavy', amplitude: 3, wavelength: 12 }, 2)[0]?.commands ?? []);
      const turns = wave.slice(1, -1).map((b, k) => {
        const [a, c] = [wave[k] as Vec2, wave[k + 2] as Vec2];
        const [u, v] = [
          { x: b.x - a.x, y: b.y - a.y },
          { x: c.x - b.x, y: c.y - b.y },
        ];
        return Math.abs((Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180) / Math.PI);
      });
      return Math.max(...turns);
    };
    const jog = (h: number): PathCommand[] => [
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 60, y: 0 } },
      { kind: 'L', to: { x: 60, y: h } },
      { kind: 'L', to: { x: 120, y: h } },
    ];
    for (const route of [bend, jog(4), jog(8), jog(12), jog(20)]) expect(sharpest(route), JSON.stringify(route[2])).toBeLessThan(60);
    // a zigzag keeps its strokes about as long through the bend as along a straight run (a chamfer cuts one short)
    const zig = pointsOf(decorateRoute(bend, { kind: 'zigzag', amplitude: 3, wavelength: 8 }, 2)[0]?.commands ?? []);
    const strokes = zig.slice(2, -1).map((p, k) => Math.hypot(p.x - (zig[k + 1] as Vec2).x, p.y - (zig[k + 1] as Vec2).y));
    // a full stroke on a straight run: half a wave along, twice the amplitude across
    expect(Math.min(...strokes)).toBeGreaterThan(0.6 * Math.hypot(8, 12));
    // a pipe whose walls are wider than the usual margin: the connector's box holds the whole stroke
    const { registries: r } = registries();
    const wide = connectorDefRouter({ id: 'lines:wide-pipe', router: 'orthogonal', decoration: { kind: 'pipe', wall: 20 } }, r.routers);
    if (wide === undefined) throw new Error('no orthogonal router');
    r.routers.register('lines:wide-pipe', wide, 'lines');
    const { file } = joined('lines:wide-pipe');
    const html = normalizeSvg(renderDocumentToHtml(file, { registries: r }).html);
    const [vx, vy, vw, vh] = (/class="fx-connector"[^>]*viewBox="([^"]+)"/.exec(html)?.[1] ?? '').split(' ').map(Number) as [number, number, number, number];
    const line = /class="fx-route-decoration" d="([^"]+)" data-part="line" style="[^"]*stroke-width:([\d.]+)/.exec(html);
    const half = Number(line?.[2]) / 2;
    expect(half).toBeGreaterThan(24);
    for (const [, x, y] of (line?.[1] ?? '').matchAll(/([\d.-]+) ([\d.-]+)/g)) {
      expect(Number(x) - half).toBeGreaterThanOrEqual(vx);
      expect(Number(y) - half).toBeGreaterThanOrEqual(vy);
      expect(Number(x) + half).toBeLessThanOrEqual(vx + vw);
      expect(Number(y) + half).toBeLessThanOrEqual(vy + vh);
    }
  });
});
