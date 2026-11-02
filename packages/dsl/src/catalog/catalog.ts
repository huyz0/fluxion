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
  /** Smart templates (`templates`), named by a screen's `template:`. */
  readonly templates: readonly CatalogEntry[];
  /** Themes (`themes`). */
  readonly themes: readonly CatalogEntry[];
  /** Effects (`effects`). */
  readonly effects: readonly CatalogEntry[];
  /** Transitions (`transitions`). */
  readonly transitions: readonly CatalogEntry[];
  /** With `core`: one line per other registrant, whose entries are listed only when asked for with `pack` (ADR-0211). */
  readonly packs?: readonly PackSummary[];
};

/**
 * A registrant the catalog does not list entry by entry (ADR-0211): what a model reads to know the pack exists and to ask for its entries.
 *
 * @public
 */
export type PackSummary = {
  /** The registrant's id: the pack a document names in `uses:` and the `pack` a catalog of its entries is built with. */
  readonly id: string;
  /** Its display name (the pack index's `name`), or its id when the host gave none. */
  readonly name: string;
  /** How many entries it registered, over every kind. */
  readonly count: number;
  /** The kinds it registered entries of (`shapes`, `markers`...), in the catalog's order. */
  readonly kinds: readonly string[];
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
  /**
   * The registrants listed entry by entry (`core` for the built-ins, `basic`...); every other registrant is summarized in {@link Catalog.packs}, one
   * line each, so a host with every first-party pack keeps the catalog within its budget (NFR-AI-002, ADR-0211). Every registrant is listed when
   * omitted; ignored with `pack`.
   */
  readonly core?: readonly string[];
  /** Pack display names by registrant id, for the summary lines; the id is used when a name is missing. */
  readonly names?: ReadonlyMap<string, string>;
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

/** The options schema of a layout or template, as JSON Schema. */
const layoutDetail: Details = (value) => {
  const schema = (value as { readonly schema?: unknown }).schema;
  if (!(schema instanceof z.ZodType)) return undefined;
  const { $schema: _omitted, ...options } = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
  return { options };
};

/** Whether `source` is listed entry by entry under `options`. */
function listed(source: string, options: CatalogOptions): boolean {
  if (options.pack !== undefined) return source === options.pack;
  return options.core === undefined || options.core.includes(source);
}

function entries(registry: Registry<string, unknown>, options: CatalogOptions, details?: Details): CatalogEntry[] {
  return registry
    .list()
    .filter(([key]) => listed(registry.source(key) ?? 'core', options))
    .map(([key, value]): CatalogEntry => {
      const base = { id: key, describe: describeOf(value) ?? '', source: registry.source(key) ?? 'core' };
      const detail = options.detail === 'full' ? details?.(value) : undefined;
      return detail === undefined ? base : { ...base, detail };
    });
}

/** The kinds of the catalog and the registry each is read from, in the catalog's order. */
const KINDS = [
  ['shapes', 'shapeDefs'],
  ['connectors', 'routers'],
  ['markers', 'markers'],
  ['layouts', 'layouts'],
  ['templates', 'templates'],
  ['themes', 'themes'],
  ['effects', 'effects'],
  ['transitions', 'transitions'],
] as const;

type Tally = Map<string, { count: number; kinds: string[] }>;

/** Count into `found` the entries of `registry` (the catalog's `kind`) whose registrant `options` does not list. */
function tally(found: Tally, registry: Registry<string, unknown>, kind: string, options: CatalogOptions): void {
  for (const [key] of registry.list()) {
    const source = registry.source(key) ?? 'core';
    if (listed(source, options)) continue;
    const summary = found.get(source) ?? { count: 0, kinds: [] };
    summary.count += 1;
    if (!summary.kinds.includes(kind)) summary.kinds.push(kind);
    found.set(source, summary);
  }
}

/** One summary per registrant `options.core` leaves out, sorted by id; none without `core` or with `pack`. */
function summaries(registries: CoreRegistries, options: CatalogOptions): PackSummary[] {
  if (options.core === undefined || options.pack !== undefined) return [];
  const found: Tally = new Map();
  for (const [kind, name] of KINDS) tally(found, registries[name] as Registry<string, unknown>, kind, options);
  return [...found]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, { count, kinds }]) => ({ id, name: options.names?.get(id) ?? id, count, kinds }));
}

/**
 * The catalog of `registries`, and a diagnostic for each listed entry that has no one-line `describe` (`FLX_REGISTRY_UNDESCRIBED`). With `core`, the
 * other registrants are summarized in `packs` (no diagnostics: their entries are checked when a catalog is built with their `pack`).
 *
 * @public
 */
export function buildCatalog(registries: CoreRegistries, options: CatalogOptions = {}): CatalogResult {
  const packs = summaries(registries, options);
  const catalog: Catalog = {
    shapes: entries(registries.shapeDefs, options, shapeDetail),
    connectors: entries(registries.routers, options),
    markers: entries(registries.markers, options),
    layouts: entries(registries.layouts, options, layoutDetail),
    templates: entries(registries.templates, options, layoutDetail),
    themes: entries(registries.themes, options),
    effects: entries(registries.effects, options),
    transitions: entries(registries.transitions, options),
    ...(packs.length === 0 ? {} : { packs }),
  };
  const described = ['shapes', 'connectors', 'markers', 'layouts', 'templates', 'effects', 'transitions'] as const;
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
