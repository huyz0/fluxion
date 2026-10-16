// The AI catalog (FR-AI-002, 06-ai-authoring.md §6): what a model may name when it writes FluxScript or a patch, generated from the registries
// the host loaded, so a plugin's shapes, layouts and markers appear beside the built-ins. An entry is an id and one line; `full` adds the
// parameters and options a model needs to use it.
import { type CoreRegistries, describeOf, type Registry } from '@fluxion/core';
import type { Diagnostic } from '@fluxion/schema';
import { z } from 'zod';

/**
 * One thing a model may name: its id, one line saying what it is, and who registered it.
 *
 * @public
 */
export type CatalogEntry = {
  /** The registry key a model writes (`basic:star`, `layered`, `orthogonal`). */
  readonly id: string;
  /** One line saying what it is (its `describe`); empty when the registrant gave none. */
  readonly describe: string;
  /** The plugin id that registered it (`core` for built-ins). */
  readonly source: string;
  /** With `full` detail: the parameters or options it takes. */
  readonly detail?: { readonly [key: string]: unknown };
};

/**
 * The catalog: one list per kind of thing, each sorted by id.
 *
 * @public
 */
export type Catalog = {
  /** Shapes (`shapeDefs`). */
  readonly shapes: readonly CatalogEntry[];
  /** Connector route types (`routers`). */
  readonly connectors: readonly CatalogEntry[];
  /** Connector end markers (`markers`). */
  readonly markers: readonly CatalogEntry[];
  /** Layouts (`layouts`). */
  readonly layouts: readonly CatalogEntry[];
  /** Themes (`themes`). */
  readonly themes: readonly CatalogEntry[];
  /** Effects (`effects`). */
  readonly effects: readonly CatalogEntry[];
  /** Transitions (`transitions`). */
  readonly transitions: readonly CatalogEntry[];
};

/**
 * What {@link buildCatalog} takes.
 *
 * @public
 */
export type CatalogOptions = {
  /** `summary` (default): ids and lines; `full`: also parameters and options. */
  readonly detail?: 'summary' | 'full';
  /** Only entries registered by this plugin id (`core`, `basic`, a plugin's id). */
  readonly pack?: string;
};

/**
 * What {@link buildCatalog} returns.
 *
 * @public
 */
export type CatalogResult = {
  /** The catalog. */
  readonly catalog: Catalog;
  /** One diagnostic per entry with no `describe` line. */
  readonly diagnostics: readonly Diagnostic[];
};

type Details = (value: unknown) => { readonly [key: string]: unknown } | undefined;

/** The parameters of a shape, by name. */
const shapeDetail: Details = (value) => {
  const params = (value as { readonly params?: { readonly [name: string]: unknown } }).params;
  return params === undefined ? undefined : { params };
};

/** The options schema of a layout, as JSON Schema. */
const layoutDetail: Details = (value) => {
  const schema = (value as { readonly schema?: unknown }).schema;
  if (!(schema instanceof z.ZodType)) return undefined;
  const { $schema: _omitted, ...options } = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
  return { options };
};

function entries(registry: Registry<string, unknown>, options: CatalogOptions, details?: Details): CatalogEntry[] {
  return registry
    .list()
    .filter(([key]) => options.pack === undefined || registry.source(key) === options.pack)
    .map(([key, value]): CatalogEntry => {
      const base = { id: key, describe: describeOf(value) ?? '', source: registry.source(key) ?? 'core' };
      const detail = options.detail === 'full' ? details?.(value) : undefined;
      return detail === undefined ? base : { ...base, detail };
    });
}

/**
 * The catalog of `registries`, and a diagnostic for each entry that has no one-line `describe` (`FLX_REGISTRY_UNDESCRIBED`).
 *
 * @public
 */
export function buildCatalog(registries: CoreRegistries, options: CatalogOptions = {}): CatalogResult {
  const catalog: Catalog = {
    shapes: entries(registries.shapeDefs, options, shapeDetail),
    connectors: entries(registries.routers, options),
    markers: entries(registries.markers, options),
    layouts: entries(registries.layouts, options, layoutDetail),
    themes: entries(registries.themes, options),
    effects: entries(registries.effects, options),
    transitions: entries(registries.transitions, options),
  };
  const described = ['shapes', 'connectors', 'markers', 'layouts', 'effects', 'transitions'] as const;
  const diagnostics = described.flatMap((kind) =>
    catalog[kind]
      .filter((entry) => entry.describe === '')
      .map(
        (entry): Diagnostic => ({
          code: 'FLX_REGISTRY_UNDESCRIBED',
          severity: 'error',
          path: `/catalog/${kind}/${entry.id}`,
          message: `"${entry.id}" (${entry.source}) has no one-line describe`,
          hint: 'give it a describe of one line, at most 160 characters',
        }),
      ),
  );
  return { catalog, diagnostics };
}
