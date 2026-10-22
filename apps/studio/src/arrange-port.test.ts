// FR-LAY-007, FR-LAY-005: the studio's Arrange runner lays a document's screen out through a layout worker and writes the boxes as one undo step.
import { createCore, createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { compile, registerApplyPatchCommand } from '@fluxion/dsl';
import { layoutTarget, setLayoutOption } from '@fluxion/editor';
import { layeredLayout, registerArrangeCommand, registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { serveLayoutWorker, type WorkerLike } from '@fluxion/layout/worker';
import { describe, expect, it } from 'vitest';
import { createArrangeRunner, layoutOptionsSchemaOf } from './arrange-port.js';

const shape = (id: string, x: number) => ({
  id,
  type: 'element',
  screenId: 's1',
  index: `a${id}`,
  kind: 'shape',
  defId: 'basic:rect',
  transform: { x, y: 0, w: 100, h: 50 },
});

function open() {
  const records = Object.fromEntries([
    ['doc', { id: 'doc', type: 'document', title: 'Arrange' }],
    ['s1', { id: 's1', type: 'screen', index: 'a0', name: 'Main' }],
    ...[shape('a', 0), shape('b', 10), shape('c', 20)].map((e) => [e.id, e] as const),
  ]);
  const core = createCore({ schemaVersion: '1.3', records } as never);
  registerBuiltInLayouts(core.registries.layouts);
  registerArrangeCommand(core.registries.commands, core.registries.layouts);
  return core;
}

/** A worker on the same thread that answers in the next microtask, as a real one answers on a message. */
function loopback(): WorkerLike {
  const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: (m) => scope.onmessage?.({ data: m }), terminate: () => undefined };
  const scope = {
    onmessage: null as ((event: { readonly data: unknown }) => void) | null,
    postMessage: (reply: unknown) => void Promise.resolve().then(() => worker.onmessage?.({ data: reply })),
  };
  serveLayoutWorker(scope, (name) => (name === 'layered' ? (layeredLayout as never) : undefined));
  return worker;
}

describe('studio arrange runner (FR-LAY-007, FR-LAY-005)', () => {
  it('FR-LAY-007: an Arrange runs in the worker, moves the elements, is one undo step, and a refusal comes back as a message', async () => {
    const core = open();
    const runner = createArrangeRunner(core, loopback);
    const before = JSON.stringify(core.store.toDocument().records);
    expect(await runner.port({ screenId: 's1' as never, scope: 'screen', algorithm: 'layered' })).toEqual({ ok: true });
    expect(JSON.stringify(core.store.toDocument().records)).not.toBe(before);
    expect(core.store.history.undo().ok).toBe(true);
    expect(JSON.stringify(core.store.toDocument().records)).toBe(before);
    const refused = await runner.port({ screenId: 'nowhere' as never, scope: 'screen' });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/no elements/);
    runner.dispose();
  });

  it('FR-LAY-001, FR-LAY-007: an option of the screen layout set from the form arranges in the worker; one undo takes back the option and the boxes', async () => {
    const core = open();
    core.execute('screen.setLayout', { id: 's1', layout: { type: 'layered', options: { direction: 'down' } } });
    core.store.history.seal();
    const runner = createArrangeRunner(core, loopback);
    let pending: Promise<unknown> = Promise.resolve();
    const port: typeof runner.port = (request) => {
      const done = runner.port(request);
      pending = done;
      return done;
    };
    const records = () => JSON.stringify(core.store.toDocument().records);
    const before = records();
    const target = layoutTarget((id) => core.store.get(id as never), [], 's1');
    expect(target?.spec).toMatchObject({ type: 'layered' });
    let ran = 0;
    const stop = core.store.subscribe(() => {
      ran += 1;
    });
    expect(setLayoutOption(core.execute, target as NonNullable<typeof target>, { screenId: 's1', key: 'direction', value: 'right' }, port)).toBe(true);
    // the spec is written at once; the boxes come from the worker
    expect(ran).toBe(1);
    expect(await pending).toEqual({ ok: true });
    stop();
    expect(ran).toBeGreaterThan(1);
    const boxes = ['a', 'b', 'c'].map((id) => (core.store.get(id as never) as unknown as { transform: { x: number; y: number } }).transform);
    // unconnected, so one rank; laid out to the right, a rank is a column: one x, three ys
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(3);
    expect(core.store.history.undo().ok).toBe(true);
    expect(records()).toBe(before);
    runner.dispose();
  });

  it('FR-LAY-001: the options schema of a registered layout or template is its JSON Schema, with defaults; none for an unknown one', () => {
    const core = open();
    registerBuiltInTemplates(core.registries.templates);
    const schemaOf = layoutOptionsSchemaOf(core);
    const stack = schemaOf({ type: 'stack' }) as Schema;
    expect(stack.properties['gap']?.type).toBe('number');
    expect(stack.properties['gap']?.default).toBeTypeOf('number');
    const process = schemaOf({ type: 'template', id: 'process.basic' }) as Schema;
    expect(process.properties['direction']?.default).toBe('right');
    expect(schemaOf({ type: 'no-such-layout' })).toBeUndefined();
    expect(schemaOf({ type: 'template', id: 'no.such' })).toBeUndefined();
    expect(schemaOf({ type: 'template' })).toBeUndefined();
  });

  it('FR-LAY-001: a template option set from the form builds the template again with it, one undo step', () => {
    const compiled = compile([...PROCESS_LINES].join(String.fromCharCode(10)), {
      registries: templateRegistries(),
    });
    const core = createCore(compiled.doc as never);
    for (const [id, def] of templateRegistries().shapeDefs.list()) core.registries.shapeDefs.register(id, def, 'basic');
    registerBuiltInLayouts(core.registries.layouts);
    registerBuiltInTemplates(core.registries.templates);
    registerApplyPatchCommand(core.registries.commands, core.registries);
    const screen = Object.values(compiled.doc?.records ?? {}).find((r) => r.type === 'screen')?.id as string;
    const xs = () =>
      Object.values(core.store.toDocument().records)
        .filter((r) => (r as { kind?: string }).kind === 'shape')
        .map((r) => (r as unknown as { transform: { x: number; y: number } }).transform);
    const before = xs();
    const target = layoutTarget((id) => core.store.get(id as never), [], screen);
    expect(target?.spec).toMatchObject({ type: 'template', id: 'process.basic' });
    expect(setLayoutOption(core.execute, target as NonNullable<typeof target>, { screenId: screen, key: 'direction', value: 'down' })).toBe(true);
    expect((core.store.get(screen as never) as unknown as { layout: unknown }).layout).toMatchObject({ options: { direction: 'down' } });
    const after = xs();
    expect(after).toHaveLength(3);
    // laid out downwards now: one column
    expect(new Set(after.map((b) => b.x)).size).toBe(1);
    expect(after.map((b) => b.y)).not.toEqual(before.map((b) => b.y));
    core.store.history.undo();
    expect(xs()).toEqual(before);
  });
});

/** A screen built from the basic process template. */
const PROCESS_LINES = ['flux: 1', 'title: T', 'uses: [basic]', 'screens:', '  - id: flow', '    template: process.basic', '    items: [Plan, Build, Ship]', ''];

type Schema = { properties: { [key: string]: { type?: string; default?: unknown } } };

/** Registries a template is compiled against: the basic shapes it draws with, the layouts and the templates. */
function templateRegistries() {
  const r = createCoreRegistries();
  for (const id of ['basic:rect', 'basic:rounded-rect', 'basic:block-arrow'])
    r.shapeDefs.register(id, { id, defaultSize: { w: 200, h: 100 } } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  registerBuiltInTemplates(r.templates);
  return r;
}
