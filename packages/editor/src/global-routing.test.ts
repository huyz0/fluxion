// FR-RTE-003: the global pass runs once the document settles; its routes are drawn only while no change that moves a route came since.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import { type GlobalRoute, type GlobalRouteInput, type Router, registerBuiltinRouters, routeConnector } from '@fluxion/routing';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlobalRouting, GLOBAL_ROUTE_SETTLE_MS, type GlobalRoutePort } from './global-routing.js';

const DETOUR: readonly PathCommand[] = [
  { kind: 'M', to: { x: 0, y: 0 } },
  { kind: 'L', to: { x: 0, y: -99 } },
];

/** A port answering when the test says so: each job's inputs and its resolver. */
function manualPort() {
  const jobs: { readonly inputs: readonly GlobalRouteInput[]; readonly answer: (routes: readonly GlobalRoute[]) => void }[] = [];
  let cancels = 0;
  const port: GlobalRoutePort = {
    run: (inputs) => new Promise((answer) => jobs.push({ inputs, answer })),
    cancel: () => {
      cancels++;
    },
  };
  return { port, jobs, cancels: () => cancels };
}

function scene() {
  const b = documentBuilder({ seed: 21 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
  const link = b.connect(a, c, { route: 'orthogonal' });
  b.connect(a, c);
  const core = createCore(b.build());
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { core, a, link, ctx: { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers } };
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(GLOBAL_ROUTE_SETTLE_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the global routing pass on drop (FR-RTE-003)', () => {
  it('FR-RTE-003: once settled the orthogonal connectors go to the port, and the answer is drawn while nothing has moved a route', async () => {
    const { core, link, ctx } = scene();
    const { port, jobs } = manualPort();
    const routing = createGlobalRouting(core.store, ctx, port);
    expect(jobs).toHaveLength(0);
    await settle();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.inputs.flatMap((i) => i.connectors.map((c) => c.id))).toEqual([link]);
    const ends = jobs[0]?.inputs[0]?.connectors[0];
    if (ends === undefined) throw new Error('no connector');
    const joined: PathCommand[] = [
      { kind: 'M', to: ends.source.point },
      { kind: 'L', to: { x: ends.source.point.x, y: -99 } },
      { kind: 'L', to: { x: ends.target.point.x, y: -99 } },
      { kind: 'L', to: ends.target.point },
    ];
    jobs[0]?.answer([{ id: link, commands: joined }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()?.get(link)).toEqual(joined);
    // the routes a query draws are the global pass's while they are set
    expect(routeConnector(core.store, { ...ctx, refined: routing.refined }, link)?.commands).toEqual(joined);
    routing.dispose();
  });

  it('FR-RTE-003: an answer to a revision the document has left is dropped; a change clears the routes and asks again once settled', async () => {
    const { core, a, link, ctx } = scene();
    const { port, jobs, cancels } = manualPort();
    const routing = createGlobalRouting(core.store, ctx, port);
    await settle();
    // the shape moves while the pass runs: the job is cancelled and its late answer is not applied
    core.store.transact('drag', (tx) => tx.patch(a, { transform: { x: 0, y: 40, w: 100, h: 100 } }));
    expect(cancels()).toBeGreaterThan(0);
    jobs[0]?.answer([{ id: link, commands: DETOUR }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()).toBeUndefined();
    // a drag: every step postpones the pass
    for (let y = 50; y <= 90; y += 10) {
      core.store.transact('drag', (tx) => tx.patch(a, { transform: { x: 0, y, w: 100, h: 100 } }));
      await vi.advanceTimersByTimeAsync(GLOBAL_ROUTE_SETTLE_MS / 2);
    }
    expect(jobs).toHaveLength(1);
    await settle();
    expect(jobs).toHaveLength(2);
    jobs[1]?.answer([{ id: link, commands: DETOUR }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()?.get(link)).toEqual(DETOUR);
    // the next change clears them at once
    core.store.transact('drag', (tx) => tx.patch(a, { transform: { x: 0, y: 0, w: 100, h: 100 } }));
    expect(routing.refined()).toBeUndefined();
    routing.dispose();
  });

  it('FR-RTE-003: a change that moves no route (a name, a style) neither clears the routes nor drops an answer in flight', async () => {
    const { core, a, link, ctx } = scene();
    const { port, jobs, cancels } = manualPort();
    const routing = createGlobalRouting(core.store, ctx, port);
    await settle();
    core.store.transact('rename', (tx) => tx.patch(a, { name: 'Start' }));
    expect(cancels()).toBe(0);
    jobs[0]?.answer([{ id: link, commands: DETOUR }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()?.get(link)).toEqual(DETOUR);
    core.store.transact('style', (tx) => tx.patch(a, { name: 'Begin', style: { opacity: 0.5 } }));
    expect(routing.refined()?.get(link)).toEqual(DETOUR);
    await settle();
    expect(jobs).toHaveLength(1);
    // a connector's route type moves its route: cleared
    core.store.transact('route', (tx) => tx.patch(link, { route: { type: 'straight' } }));
    expect(routing.refined()).toBeUndefined();
    routing.dispose();
  });

  it('FR-RTE-003: a router or shape definition registered or disposed clears the routes and asks again once settled', async () => {
    const { core, link, ctx } = scene();
    const { port, jobs, cancels } = manualPort();
    const routing = createGlobalRouting(core.store, ctx, port);
    await settle();
    jobs[0]?.answer([{ id: link, commands: DETOUR }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()?.get(link)).toEqual(DETOUR);
    const registered = ctx.routers.register(
      'test:router',
      {
        route: ({ source, target }) => [
          { kind: 'M', to: source.point },
          { kind: 'L', to: target.point },
        ],
      },
      'test',
    );
    expect(registered.ok).toBe(true);
    expect(cancels()).toBe(1);
    expect(routing.refined()).toBeUndefined();
    await settle();
    expect(jobs).toHaveLength(2);
    routing.dispose();
  });

  it('FR-RTE-003: after dispose nothing runs and a late answer is dropped', async () => {
    const { core, link, ctx } = scene();
    const { port, jobs } = manualPort();
    const routing = createGlobalRouting(core.store, ctx, port);
    await settle();
    routing.dispose();
    jobs[0]?.answer([{ id: link, commands: DETOUR }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(routing.refined()).toBeUndefined();
    core.store.transact('drag', (tx) => tx.patch(link, { labels: [] }));
    await settle();
    expect(jobs).toHaveLength(1);
  });
});
