// Packs (FR-EXT-001, ADR-0016, ADR-0017): a namespace of shape definitions, registered into core's
// registries through the public registry API only. First-party packs use exactly this.
import { type CoreRegistries, type Disposable, type PluginId, parseShapeDef, type ShapeDef } from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';

/**
 * What a pack is made of.
 *
 * @public
 */
export type PackSpec = {
  /** The pack's namespace, lower case (`basic`); every definition id starts with `<id>:`. */
  readonly id: string;
  /** Shape definitions (validated when the pack is registered). */
  readonly shapes?: readonly ShapeDef[];
};

/**
 * The registries a pack registers into (a host's core registries).
 *
 * @public
 */
export type PackRegistries = Pick<CoreRegistries, 'shapeDefs'>;

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
  registries: PackRegistries,
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

/** Registers every shape of `pack`; on the first refusal, undoes the ones already registered. */
function registerAll(pack: Pack, registries: PackRegistries): Result<Disposable, readonly Diagnostic[]> {
  const done: Disposable[] = [];
  for (const [k, def] of pack.shapes.entries()) {
    const r = registerShapeDef(registries, def, pack.id, ['shapes', k]);
    if (!r.ok) {
      for (const d of done) d.dispose();
      return r;
    }
    done.push(r.value);
  }
  return ok({
    dispose: () => {
      for (const d of done) d.dispose();
    },
  });
}

/**
 * Define a pack. Nothing is registered until the host calls `register` with its registries.
 *
 * @example
 * ```ts
 * export const basicPack = definePack({ id: 'basic', shapes: [rect, ellipse] });
 * const registered = basicPack.register(registries); // Result: all registered, or diagnostics
 * ```
 *
 * @public
 */
export function definePack(spec: PackSpec): Pack {
  const pack: Pack = {
    id: spec.id,
    shapes: spec.shapes ?? [],
    register: (registries) => {
      if (!PACK_ID.test(pack.id)) return err([packProblem(['id'], `pack id "${pack.id}" must be lower-case letters, digits and "-"`)]);
      // validate everything first, so a broken pack reports all its problems at once
      const problems = pack.shapes.flatMap((def, k) => {
        const r = parseShapeDef(def, ['shapes', k]);
        return r.ok ? [] : r.error;
      });
      return problems.length > 0 ? err(problems) : registerAll(pack, registries);
    },
  };
  return pack;
}
