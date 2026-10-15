// Registering layouts (FR-LAY-001): a layout is a registry entry under its id; M13.5 requires an options schema and capabilities, so the
// inspector, the DSL and the catalog can read an algorithm's options without running it.
import type { Registry } from '@fluxion/core';
import { z } from 'zod';
import type { LayoutAlgorithm } from './types.js';

/** Why `c` is not a set of layout capabilities, or undefined when it is one. */
function capabilitiesProblem(id: string, c: Partial<LayoutAlgorithm<unknown>>['capabilities']): string | undefined {
  if (typeof c !== 'object' || c === null) return `layout "${id}" needs capabilities`;
  if (typeof c.pins !== 'boolean' || typeof c.compound !== 'boolean') return `layout "${id}": capabilities.pins and capabilities.compound must be booleans`;
  if (c.runsIn !== 'main' && c.runsIn !== 'worker' && c.runsIn !== 'either') return `layout "${id}": capabilities.runsIn must be "main", "worker" or "either"`;
  return undefined;
}

/** Why `value` is not a layout algorithm, or undefined when it is one. */
function shapeProblem(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'a layout must be an object';
  const a = value as Partial<LayoutAlgorithm<unknown>>;
  if (typeof a.id !== 'string' || a.id === '') return 'a layout needs an id';
  if (typeof a.version !== 'string') return `layout "${a.id}" needs a version`;
  if (typeof a.run !== 'function') return `layout "${a.id}" needs a run function`;
  if (typeof a.parseOptions !== 'function') return `layout "${a.id}" needs parseOptions`;
  if (typeof a.schema !== 'object' || a.schema === null || typeof a.schema.safeParse !== 'function') return `layout "${a.id}" needs an options schema`;
  return capabilitiesProblem(a.id, a.capabilities);
}

/**
 * The outcome of {@link registerLayout}: registered, or why not.
 *
 * @public
 */
export type RegisterLayoutResult =
  | {
      /** Registered. */
      readonly ok: true;
    }
  | {
      /** Refused. */
      readonly ok: false;
      /** Why: the malformed part of the layout, or the name held by another source. */
      readonly message: string;
    };

/**
 * Register `algorithm` in a host's `layouts` registry for `source`. A value that is not a layout algorithm (no id, version, `run`,
 * `parseOptions`, options `schema` or `capabilities`) is refused with its reason and nothing is registered.
 *
 * @public
 */
export function registerLayout<O>(layouts: Registry<string, unknown>, algorithm: LayoutAlgorithm<O>, source: string): RegisterLayoutResult {
  const problem = shapeProblem(algorithm);
  if (problem) return { ok: false, message: problem };
  const r = layouts.register(algorithm.id, algorithm, source);
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}

/**
 * The registered layouts, sorted by id: what the inspector picker and the catalog list. Entries that are not layout algorithms are left out.
 *
 * @public
 */
export function listLayouts(layouts: Registry<string, unknown>): readonly LayoutAlgorithm<unknown>[] {
  return layouts
    .list()
    .map(([, value]) => value)
    .filter((value): value is LayoutAlgorithm<unknown> => shapeProblem(value) === undefined);
}

/**
 * The options of `algorithm` as JSON Schema, for the inspector form, AI catalog and MCP tool schemas (FR-LAY-001).
 *
 * @public
 */
export function layoutOptionsJsonSchema(algorithm: LayoutAlgorithm<unknown>): unknown {
  return z.toJSONSchema(algorithm.schema, { io: 'input' });
}
