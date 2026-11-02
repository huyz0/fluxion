// The catalog as text (FR-AI-002): `llm` for prompts (one line per entry), `json` for tools and editors, `md` for the docs site.
import type { Catalog, CatalogEntry, PackSummary } from './catalog.js';

/**
 * A catalog text format.
 *
 * @public
 */
export type CatalogFormat = 'llm' | 'json' | 'md';

/** The kinds in the order the catalog prints them, with their heading. */
const KINDS = [
  ['shapes', 'Shapes'],
  ['connectors', 'Connector routes'],
  ['markers', 'Connector end markers'],
  ['layouts', 'Layouts'],
  ['templates', 'Templates'],
  ['themes', 'Themes'],
  ['effects', 'Effects'],
  ['transitions', 'Transitions'],
] as const;

/** A shape's parameters as `name:type=default`, or an options object's property names. */
function detailText(entry: CatalogEntry): string {
  const detail = entry.detail;
  if (detail === undefined) return '';
  const params = detail['params'];
  if (typeof params === 'object' && params !== null) {
    const list = Object.entries(params).map(([name, spec]) => {
      const p = spec as { readonly type?: string; readonly default?: unknown };
      return `${name}:${p.type ?? '?'}=${JSON.stringify(p.default)}`;
    });
    return list.length > 0 ? `; params: ${list.join(', ')}` : '';
  }
  const options = detail['options'] as { readonly properties?: { readonly [name: string]: unknown } } | undefined;
  const names = Object.keys(options?.properties ?? {});
  return names.length > 0 ? `; options: ${names.join(', ')}` : '';
}

const line = (entry: CatalogEntry): string => `${entry.id} — ${entry.describe}${detailText(entry)}`;

/** How many entries a summarized pack registered, and of which kinds. */
const counted = (pack: PackSummary): string => `${pack.count} ${pack.count === 1 ? 'entry' : 'entries'} (${pack.kinds.join(', ')})`;

/** A summarized pack: its name, what it registered, and how to read its entries (ADR-0211). */
const packLine = (pack: PackSummary): string => `${pack.id} — ${pack.name}; ${counted(pack)}; listed with pack: ${pack.id}`;

/** One line per entry under a `kind:` header; kinds with no entries are left out; summarized packs last, under `packs:`. */
function llmText(catalog: Catalog): string {
  const blocks = KINDS.flatMap(([kind]) => (catalog[kind].length === 0 ? [] : [`${kind}:`, ...catalog[kind].map((entry) => `${line(entry)}`)]));
  const packs = catalog.packs ?? [];
  return `${[...blocks, ...(packs.length === 0 ? [] : ['packs:', ...packs.map(packLine)])].join('\n')}\n`;
}

/** A heading per kind and a bullet per entry, with the registering plugin. */
function markdownText(catalog: Catalog): string {
  const blocks = KINDS.flatMap(([kind, heading]) =>
    catalog[kind].length === 0
      ? []
      : [`## ${heading}`, '', ...catalog[kind].map((entry) => `- \`${entry.id}\` (${entry.source}): ${entry.describe}${detailText(entry)}`), ''],
  );
  const packs = catalog.packs ?? [];
  const summarized = packs.length === 0 ? [] : ['## Packs', '', ...packs.map((pack) => `- \`${pack.id}\`: ${pack.name}; ${counted(pack)}`), ''];
  return `# Fluxion catalog\n\n${[...blocks, ...summarized].join('\n')}`;
}

/**
 * The catalog as text. `llm` prints a `kind:` header and one `id — describe` line per entry (with `; params:` or `; options:` when the catalog was
 * built with full detail); `json` prints the catalog object; `md` prints headings and bullets. All three end with a newline and list entries in the
 * catalog's order (sorted by id). A catalog built with `core` ends with its summarized packs, one line each (`packs:`, `## Packs`; ADR-0211).
 *
 * @public
 */
export function formatCatalog(catalog: Catalog, format: CatalogFormat): string {
  if (format === 'json') return `${JSON.stringify(catalog, null, 2)}\n`;
  return format === 'md' ? markdownText(catalog) : llmText(catalog);
}
