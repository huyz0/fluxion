// The catalog completion reads (FR-DSL-009, ADR-0032), built from what the editor already holds: the shape registry, the theme record the
// document or screen uses, and the screen's elements. Each list is read when asked, so an edit shows in the next completion. Lazy chunk.
import type { ReadView, Registry, ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { isToken, LIGHT_THEME, type TokenGroup } from '@fluxion/theme';
import type { CompletionCatalog } from './completion.js';

/** What the catalog is built from. */
export type CatalogSource = {
  /** The core's shape registry (the packs' shapes included). */
  readonly shapeDefs: Pick<Registry<string, ShapeDef>, 'list'>;
  /** The document store (or a view of it). */
  readonly view: ReadView;
  /** The open screen, read when completion asks. */
  readonly screen: () => RecordId | undefined;
};

/** The dot path of every token in `group`. */
function tokenNames(group: TokenGroup, prefix = ''): string[] {
  return Object.entries(group).flatMap(([name, node]) => {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (isToken(node as never)) return [path];
    return typeof node === 'object' && node !== null ? tokenNames(node as TokenGroup, path) : [];
  });
}

type Rec = { readonly themeId?: unknown; readonly tokens?: unknown; readonly semantic?: { readonly slug?: unknown }; readonly type?: unknown };

/** The tokens of the theme the screen uses, else the document's, else the built-in light theme. */
function themeTokens(view: ReadView, screen: RecordId | undefined): TokenGroup {
  const ids = [
    screen === undefined ? undefined : (view.get(screen) as Rec | undefined)?.themeId,
    (view.get(view.members('byType', 'document')[0] as RecordId) as Rec | undefined)?.themeId,
  ];
  for (const id of ids) {
    const tokens = typeof id === 'string' ? (view.get(id as RecordId) as Rec | undefined)?.tokens : undefined;
    if (typeof tokens === 'object' && tokens !== null) return tokens as TokenGroup;
  }
  return LIGHT_THEME.tokens;
}

/**
 * The completion catalog of an open document.
 *
 * @param source - the shape registry, the store and the open screen
 * @returns the lists completion reads
 */
export function completionCatalog(source: CatalogSource): CompletionCatalog {
  const shapes = () => source.shapeDefs.list().map(([id]) => id);
  return {
    shapes,
    tokens: () => tokenNames(themeTokens(source.view, source.screen())),
    slugs: () => {
      const screen = source.screen();
      if (screen === undefined) return [];
      const slugs = source.view.members('byScreen', screen).map((id) => (source.view.get(id) as Rec | undefined)?.semantic?.slug);
      return [...new Set(slugs.filter((s): s is string => typeof s === 'string' && s !== ''))];
    },
    packs: () => [...new Set(shapes().flatMap((id) => (id.includes(':') ? [id.slice(0, id.indexOf(':'))] : [])))],
  };
}
