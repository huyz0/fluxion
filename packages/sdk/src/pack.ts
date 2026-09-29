// Packs (FR-EXT-001, ADR-0016, ADR-0017 and its M5.36 amendment): a namespace of shape definitions and
// connector end markers, registered into core's registries through the public registry API only.
// First-party packs use exactly this.
import {
  type CoreRegistries,
  type Disposable,
  type MarkerDef,
  type PluginId,
  parseMarkerDef,
  parseShapeDef,
  type Registry,
  type ShapeDef,
} from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';

/**
 * What a pack is made of.
 *
 * @public
 */
export type PackSpec = {
  /** The pack's namespace, lower case (`basic`); every definition and marker id starts with `<id>:`. */
  readonly id: string;
  /** Shape definitions (validated when the pack is registered). */
  readonly shapes?: readonly ShapeDef[];
  /** Connector end markers (validated when the pack is registered). */
  readonly markers?: readonly MarkerDef[];
};

/**
 * The registries a pack registers into (a host's core registries).
 *
 * @public
 */
export type PackRegistries = Pick<CoreRegistries, 'shapeDefs' | 'markers'>;

/**
 * A defined pack.
 *
 * @public
 */
export type Pack = {
  /** The pack's namespace. */
  readonly id: string;
  /** Its shape definitions. */
  readonly shapes: readonly ShapeDef[];
  /** Its connector end markers. */
  readonly markers: readonly MarkerDef[];
  /**
   * Validate and register everything under the pack's id as source: all of it, or nothing and the
   * diagnostics (`FLX_PACK_INVALID`, `FLX_SHAPE_DEF_INVALID`, `FLX_REGISTRY_DUPLICATE`).
   */
  register(registries: PackRegistries): Result<Disposable, readonly Diagnostic[]>;
};

const PACK_ID = /^[a-z0-9][a-z0-9-]*$/;

const packProblem = (at: ReadonlyArray<string | number>, message: string): Diagnostic => ({
  code: 'FLX_PACK_INVALID',
  severity: 'error',
  path: jsonPointer(at),
  message,
});

/**
 * Validate `def` and register it in `registries.shapeDefs` for `source`; its id must be in the
 * source's namespace (`<source>:<name>`). Diagnostics point under `at`.
 *
 * @public
 */
export function registerShapeDef(
  registries: Pick<PackRegistries, 'shapeDefs'>,
  def: unknown,
  source: PluginId,
  at: ReadonlyArray<string | number> = [],
): Result<Disposable, readonly Diagnostic[]> {
  const parsed = parseShapeDef(def, at);
  if (!parsed.ok) return parsed;
  const { id } = parsed.value;
  if (!id.startsWith(`${source}:`)) return err([packProblem([...at, 'id'], `shape id "${id}" is outside the namespace "${source}:" of ${source}`)]);
  const registered = registries.shapeDefs.register(id, parsed.value, source);
  return registered.ok ? registered : err([{ ...registered.error, path: jsonPointer([...at, 'id']) }]);
}

/** One kind of entry a pack holds: its field, what an entry is called, its parser and its registry. */
type Part<T extends { readonly id: string }> = {
  readonly field: 'shapes' | 'markers';
  readonly noun: string;
  readonly parse: (input: unknown, at: ReadonlyArray<string | number>) => Result<T, readonly Diagnostic[]>;
  readonly registry: Registry<string, T>;
};

/**
 * Every problem of the entries `items` of `pack` (one part) before anything is registered: invalid
 * entries, ids outside the namespace or given twice, and keys another source holds (M5.8 review F2).
 */
function partProblems<T extends { readonly id: string }>(pack: Pack, part: Part<T>, items: readonly T[]): Diagnostic[] {
  const first = new Map<string, number>();
  return items.flatMap((item, k) => {
    const parsed = part.parse(item, [part.field, k]);
    if (!parsed.ok) return [...parsed.error];
    const { id } = parsed.value;
    const at = [part.field, k, 'id'];
    if (!id.startsWith(`${pack.id}:`)) return [packProblem(at, `${part.noun} id "${id}" is outside the namespace "${pack.id}:" of ${pack.id}`)];
    const earlier = first.get(id);
    first.set(id, earlier ?? k);
    if (earlier !== undefined) return [packProblem(at, `${part.noun} id "${id}" is defined twice (also /${part.field}/${earlier})`)];
    const holder = part.registry.source(id);
    if (holder !== undefined && holder !== pack.id)
      return [
        {
          code: 'FLX_REGISTRY_DUPLICATE',
          severity: 'error',
          path: jsonPointer(at),
          message: `"${id}" is already registered in ${part.registry.name} by ${holder}`,
        } as const,
      ];
    return [];
  });
}

/**
 * Registers every entry of a part `partProblems` found nothing wrong with. Nothing can be refused then
 * (registries are synchronous, and only another source's key is refused), so there is no rollback that
 * could remove this pack's live entries (M5.8 review F1).
 */
function registerPart<T extends { readonly id: string }>(pack: Pack, registry: Registry<string, T>, items: readonly T[]): Disposable[] {
  return items.map((item) => {
    const r = registry.register(item.id, item, pack.id);
    // tzap disable next-line ConditionalExpression,BlockStatement,StringLiteral: refused only for another source's key, checked above
    if (!r.ok) throw new Error(`pack ${pack.id}: ${r.error.message}`);
    return r.value;
  });
}

/**
 * Define a pack. Nothing is registered until the host calls `register` with its registries.
 *
 * @example
 * ```ts
 * export const basicPack = definePack({ id: 'basic', shapes: [rect, ellipse], markers: [openArrow] });
 * const registered = basicPack.register(registries); // Result: all registered, or diagnostics
 * ```
 *
 * @public
 */
export function definePack(spec: PackSpec): Pack {
  const pack: Pack = {
    id: spec.id,
    shapes: spec.shapes ?? [],
    markers: spec.markers ?? [],
    register: (registries) => {
      if (!PACK_ID.test(pack.id)) return err([packProblem(['id'], `pack id "${pack.id}" must be lower-case letters, digits and "-"`)]);
      const shapes: Part<ShapeDef> = { field: 'shapes', noun: 'shape', parse: parseShapeDef, registry: registries.shapeDefs };
      const markers: Part<MarkerDef> = { field: 'markers', noun: 'marker', parse: parseMarkerDef, registry: registries.markers };
      // everything is checked first, so a broken pack reports all its problems and registers nothing
      const problems = [...partProblems(pack, shapes, pack.shapes), ...partProblems(pack, markers, pack.markers)];
      if (problems.length > 0) return err(problems);
      const done = [...registerPart(pack, registries.shapeDefs, pack.shapes), ...registerPart(pack, registries.markers, pack.markers)];
      return ok({
        dispose: () => {
          for (const d of done) d.dispose();
        },
      });
    },
  };
  return pack;
}
