/**
 * `@fluxion/pack-layouts-elk` — Optional ELK layouts pack: elkjs (EPL-2.0) layered, stress and rectpacking as layouts-elk:*; registered only when installed (ADR-0045).
 *
 * @packageDocumentation
 */
import { loadElkEngine } from './engine.js';
import { type ElkLayout, elkLayouts } from './layouts.js';

export type { ElkEdge, ElkEngine, ElkNode } from './engine.js';
export { type ElkBox, type ElkLayout, type ElkLayoutInput, type ElkOptionsResult, elkLayouts } from './layouts.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * A host's `layouts` registry, as far as the pack writes to it.
 *
 * @public
 */
export type LayoutRegistryLike = {
  /** Registers `value` under `id` for `source`; refused when the id is taken. */
  register(
    id: string,
    value: unknown,
    source: string,
  ): {
    /** True when registered. */
    readonly ok: boolean;
  };
};

/**
 * Load elkjs (a chunk of its own, fetched only now) and give its three layouts.
 *
 * @public
 */
export async function loadElkLayouts(): Promise<readonly ElkLayout<never>[]> {
  return elkLayouts(await loadElkEngine());
}

/**
 * Register the ELK layouts in a host's `layouts` registry, under source `layouts-elk`; a host that has the pack installed calls this, in the
 * realm where layouts run (the layout worker). The ids registered.
 *
 * @public
 */
export async function registerElkLayouts(layouts: LayoutRegistryLike): Promise<readonly string[]> {
  const loaded = await loadElkLayouts();
  return loaded.filter((layout) => layouts.register(layout.id, layout, 'layouts-elk').ok).map((layout) => layout.id);
}
