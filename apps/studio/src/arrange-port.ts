// The studio's Arrange runner (FR-LAY-007, M13.30): the editor's Arrange commands go through a layout worker, so a large diagram does not block the
// page. One worker host per open document; each arrange reads the snapshot on the page's thread, lays it out in the worker and writes the boxes as one
// undo step (`createAsyncArranger`).
import type { Core } from '@fluxion/core';
import type { ArrangePort, OptionsSchemaOf } from '@fluxion/editor';
import { createAsyncArranger, type LayoutAlgorithm, layoutOptionsJsonSchema, type TemplateDef, templateOptionsJsonSchema } from '@fluxion/layout';
import { createLayoutHost, type WorkerLike } from '@fluxion/layout/worker';

/**
 * An Arrange runner over `core` and the way to end its workers.
 *
 * @public
 */
export type ArrangeRunner = {
  /** What the editor's `arrange` takes. */
  readonly port: ArrangePort;
  /** End the workers (the document closed); jobs in flight reject. */
  readonly dispose: () => void;
};

/** Boxes written per slice: a 500-element Arrange is a few dozen short writes, one undo step, so no write holds the page's thread past 50 ms. */
const SLICE = 8;

/** A layout worker running the studio's worker module. */
// a DOM Worker has the members WorkerLike names; its handlers take a MessageEvent, which has the `data` the host reads
const browserWorker = (): WorkerLike => new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/**
 * The Arrange runner of an open document. `spawn` starts a layout worker (the studio's module in a browser; a test passes its own).
 *
 * @public
 */
export function createArrangeRunner(core: Core, spawn: () => WorkerLike = browserWorker): ArrangeRunner {
  const host = createLayoutHost(spawn);
  const arrange = createAsyncArranger({
    store: core.store,
    execute: (id, args, options) => core.execute(id, args, options),
    slice: SLICE,
    // between two slices the page draws and answers input
    pause: () => new Promise<void>((resume) => void setTimeout(resume, 0)),
    host,
    lookup: (name) => core.registries.layouts.get(name) as LayoutAlgorithm<never> | undefined,
  });
  return {
    port: async (request) => {
      const done = await arrange(request);
      return done.ok ? { ok: true } : { ok: false, message: done.error.message };
    },
    dispose: () => host.dispose(),
  };
}

/**
 * The JSON Schema of the options of each layout and template registered with `core`, for the inspector's layout options form (FR-LAY-001, M17.17).
 *
 * @public
 */
export function layoutOptionsSchemaOf(core: Core): OptionsSchemaOf {
  return (layout) => {
    if (layout.type === 'template') {
      const template = typeof layout['id'] === 'string' ? (core.registries.templates.get(layout['id']) as TemplateDef<unknown> | undefined) : undefined;
      return template === undefined ? undefined : templateOptionsJsonSchema(template);
    }
    const algorithm = core.registries.layouts.get(layout.type) as LayoutAlgorithm<unknown> | undefined;
    return algorithm === undefined ? undefined : layoutOptionsJsonSchema(algorithm);
  };
}
