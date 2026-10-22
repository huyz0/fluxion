// The catalog as text (FR-AI-002): `llm` for prompts (one line per entry), `json` for tools and editors, `md` for the docs site.
import type { Catalog, CatalogEntry } from './catalog.js';

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

/** One line per entry under a `kind:` header; kinds with no entries are left out. */
function llmText(catalog: Catalog): string {
  const blocks = KINDS.flatMap(([kind]) => (catalog[kind].length === 0 ? [] : [`${kind}:`, ...catalog[kind].map((entry) => `${line(entry)}`)]));
  return `${blocks.join('\n')}\n`;
}

/** A heading per kind and a bullet per entry, with the registering plugin. */
function markdownText(catalog: Catalog): string {
  const blocks = KINDS.flatMap(([kind, heading]) =>
    catalog[kind].length === 0
      ? []
      : [`## ${heading}`, '', ...catalog[kind].map((entry) => `- \`${entry.id}\` (${entry.source}): ${entry.describe}${detailText(entry)}`), ''],
  );
  return `# Fluxion catalog\n\n${blocks.join('\n')}`;
}

/**
 * The catalog as text. `llm` prints a `kind:` header and one `id — describe` line per entry (with `; params:` or `; options:` when the catalog was
 * built with full detail); `json` prints the catalog object; `md` prints headings and bullets. All three end with a newline and list entries in the
 * catalog's order (sorted by id).
 *
 * @public
 */
export function formatCatalog(catalog: Catalog, format: CatalogFormat): string {
  if (format === 'json') return `${JSON.stringify(catalog, null, 2)}\n`;
  return format === 'md' ? markdownText(catalog) : llmText(catalog);
}
