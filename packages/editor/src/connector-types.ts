// Pack connector types in the inspector (FR-CON-010, M18.112): the connector's Route field offers the pack types its host
// registered (decorated routers, routing `connectorDefRouter`) after the built-in routers the schema lists.
import type { Router } from '@fluxion/routing';
import type { Inspectors } from './inspector-model.js';

/** The routers a host holds. */
type Routers = { list(): ReadonlyArray<readonly [string, Router]> };

/**
 * The ids of the pack connector types in `routers` (a decorated router names its `base`), sorted.
 *
 * @public
 */
export function packConnectorTypes(routers: Routers): readonly string[] {
  return routers
    .list()
    .filter(([, router]) => typeof (router as { readonly base?: unknown }).base === 'string')
    .map(([id]) => id);
}

/** One overrides object per routers, so the inspector's memo keeps it across renders. */
const made = new WeakMap<Routers, Inspectors>();

/**
 * Inspector overrides that add `routers`' pack connector types to the connector's Route choices, read when the inspector
 * builds its fields (so types registered later are offered too); the same object for the same `routers`.
 *
 * @public
 */
export function connectorTypeInspectors(routers: Routers): Inspectors {
  const known = made.get(routers);
  if (known !== undefined) return known;
  const inspectors: Inspectors = {
    get: (kind) =>
      kind !== 'connector'
        ? undefined
        : (fields) =>
            fields.map((field) =>
              field.path.join('.') === 'route.type' ? { ...field, options: [...(field.options ?? []), ...packConnectorTypes(routers)] } : field,
            ),
  };
  made.set(routers, inspectors);
  return inspectors;
}
