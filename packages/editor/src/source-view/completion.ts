// Completion of the source view (FR-DSL-009, ADR-0032): shape ids from `shapeDefs` (packs included), token names of the theme, slugs of the current
// screen after an edge op, anchors after a dot, packs in `uses`, and the key table's keys at each level. The data comes in through a
// `CompletionCatalog` the host builds from the registries and the store it already holds; nothing here reads a registry. Part of the lazy chunk.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EDGE_OPS, fluxScriptKeys } from '@fluxion/dsl';
import { type Site, siteAt } from './completion-site.js';

/** What completion reads: lists, each a function so the editor's live state is read when the cursor asks. */
export type CompletionCatalog = {
  /** The qualified ids of the registered shapes (`basic:rect`). */
  readonly shapes: () => readonly string[];
  /** The dotted token names of the active theme (`color.text.primary`). */
  readonly tokens: () => readonly string[];
  /** The slugs of the nodes and groups of the current screen. */
  readonly slugs: () => readonly string[];
  /** The pack namespaces shapes come from. */
  readonly packs: () => readonly string[];
};

/** The completions at an offset: where the replaced word starts, the options, and the pattern the list stays valid for while typing. */
export type CompletionsAt = { readonly from: number; readonly options: Completion[]; readonly validFor: RegExp };

const ANCHORS = ['n', 'e', 's', 'w'] as const;
const VALID = /^[\w.:-]*$/;
/** The packs `uses` names, flow (`uses: [a, b]`) or block, so their shapes are offered by short name. */
export function usedPacks(text: string): readonly string[] {
  const flow = /^uses:[ \t]*\[([^\]\n]*)\]/m.exec(text);
  if (flow)
    return (flow[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s !== '');
  const block = /^uses:[ \t]*\n((?:[ \t]*-[ \t]+\S.*\n?)+)/m.exec(text);
  return (block?.[1] ?? '')
    .split('\n')
    .map((l) => /^\s*-\s+["']?([^\s"']+)/.exec(l)?.[1] ?? '')
    .filter((s) => s !== '');
}

const option = (label: string, type: string, boost: number, detail?: string): Completion => ({
  label,
  type,
  boost,
  ...(detail === undefined ? {} : { detail }),
});

/** Qualified ids, and the short names of the packs the file `uses`. */
function shapeOptions(ids: readonly string[], used: ReadonlySet<string>): Completion[] {
  const out: Completion[] = [];
  for (const id of ids) {
    const colon = id.indexOf(':');
    const pack = colon > 0 ? id.slice(0, colon) : undefined;
    out.push(option(id, 'type', used.has(pack ?? '') ? 5 : 0, pack));
    if (pack !== undefined && used.has(pack)) out.push(option(id.slice(colon + 1), 'type', 8, pack));
  }
  return out;
}

/** The keys of one level: the ones the compiler reads first, the deferred ones after and as `keyword`s, with no prose label (no string to translate). */
function keyOptions(level: keyof ReturnType<typeof fluxScriptKeys>): Completion[] {
  const table = fluxScriptKeys()[level];
  return [...table.compiled.map((k) => option(k, 'property', 10)), ...table.deferred.map((k) => option(k, 'keyword', -10))];
}

const slugOptions = (slugs: readonly string[]): Completion[] => slugs.map((s) => option(s, 'variable', 0));

type Resolver = (text: string, catalog: CompletionCatalog) => Completion[];

/** What each kind of site offers, looked up by the site's kind (a table, so a new kind is one entry; the key sites carry a level and are handled by `optionsFor`). */
const RESOLVERS: { readonly [kind: string]: Resolver } = {
  shape: (text, catalog) => shapeOptions(catalog.shapes(), new Set(usedPacks(text))),
  token: (_, catalog) => catalog.tokens().map((t) => option(t, 'constant', 0)),
  pack: (_, catalog) => catalog.packs().map((p) => option(p, 'type', 0)),
  slug: (_, catalog) => slugOptions(catalog.slugs()),
  anchor: () => ANCHORS.map((a) => option(a, 'constant', 0)),
  op: () => EDGE_OPS.map((o) => option(o, 'keyword', 0)),
  'edge-start': (_, catalog) => [...slugOptions(catalog.slugs()), ...keyOptions('edge').map((o) => ({ ...o, boost: (o.boost ?? 0) - 20 }))],
};

function optionsFor(site: Site, text: string, catalog: CompletionCatalog): Completion[] {
  if (site.kind === 'key') return keyOptions(site.level);
  return RESOLVERS[site.kind]?.(text, catalog) ?? [];
}

/**
 * The completions at `pos` in `text`: shape ids after `shape:` and `component:`, token names in style values and `background`, slugs and anchors
 * in edges (`a -> |`, `api.|`), `contains` and `from`/`to`, packs in `uses`, and the key table's keys at each level (deferred keys last).
 * The list is unfiltered: the editor narrows it by the word typed since `from`.
 *
 * @param text - the FluxScript text, possibly invalid
 * @param pos - the cursor offset
 * @param catalog - the live lists
 * @returns the options, or null where nothing is offered (comments, quoted strings, block scalars, unknown places)
 */
export function completionsAt(text: string, pos: number, catalog: CompletionCatalog): CompletionsAt | null {
  const site = siteAt(text, pos);
  if (site === undefined) return null;
  const options = optionsFor(site, text, catalog);
  return options.length === 0 ? null : { from: site.from, options, validFor: VALID };
}

/**
 * The completion extension of the source view.
 *
 * @param catalog - the live lists completion reads
 * @returns a CodeMirror extension
 */
export function fluxScriptCompletion(catalog: CompletionCatalog): Extension {
  const source = (cx: CompletionContext): CompletionResult | null => {
    const r = completionsAt(cx.state.doc.toString(), cx.pos, catalog);
    return r === null ? null : { from: r.from, options: r.options, validFor: r.validFor };
  };
  return autocompletion({ override: [source], icons: false });
}
