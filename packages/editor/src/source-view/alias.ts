// Which record of the document is each record of the base compile (FR-EDT-022, ADR-0031 "the source view maps the old id to the new one"): the base compile gives
// every owned record the id its key derives, but a record made by hand in the editor has a random id. The slug the decompiler wrote for it says which node it is;
// an edge is its two ends (the nth of those joining the same two nodes, in z-order); a binding is its edge's end. Pure.
import type { Recs } from './merge.js';
import type { Rec } from './remap.js';

type Loose = { readonly [key: string]: unknown };

const slugOf = (r: Rec): unknown => (r['semantic'] as Loose | undefined)?.['slug'];
const isConnector = (r: Rec): boolean => r.type === 'element' && r['kind'] === 'connector';
const order = (a: Rec, b: Rec): number => {
  const [x, y] = [String(a['index']), String(b['index'])];
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
};

/** The connectors of `records` on `screen` (any when undefined), by their ends as `source>target` in the ids `own` gives, each list in z-order. */
function connectorsByEnds(records: Recs, screen: string | undefined, own: (id: string) => string): Map<string, Rec[]> {
  const ends = new Map<string, { source?: string; target?: string }>();
  for (const r of Object.values(records)) {
    if (r.type !== 'binding') continue;
    const at = ends.get(String(r['connectorId'])) ?? {};
    at[r['end'] === 'source' ? 'source' : 'target'] = own(String(r['elementId']));
    ends.set(String(r['connectorId']), at);
  }
  const out = new Map<string, Rec[]>();
  for (const r of Object.values(records).filter((x) => isConnector(x) && (screen === undefined || x['screenId'] === screen))) {
    const key = `${ends.get(r.id)?.source}>${ends.get(r.id)?.target}`;
    out.set(key, [...(out.get(key) ?? []), r].sort(order));
  }
  return out;
}

/** The nodes: the document's element with the slug of each node of the base. */
function nodeAlias(base: Recs, doc: Recs, slugs: ReadonlyMap<string, string>): Map<string, string> {
  const bySlug = new Map<string, string>();
  for (const r of Object.values(base)) if (r.type === 'element' && !isConnector(r) && typeof slugOf(r) === 'string') bySlug.set(slugOf(r) as string, r.id);
  const out = new Map<string, string>();
  for (const [docId, slug] of slugs) {
    const baseId = bySlug.get(slug);
    if (baseId !== undefined && baseId !== docId && doc[docId]?.type === 'element') out.set(baseId, docId);
  }
  return out;
}

/** The bindings of `records` by the connector they belong to. */
function bindingsByConnector(records: Recs): Map<string, Rec[]> {
  const out = new Map<string, Rec[]>();
  for (const r of Object.values(records)) if (r.type === 'binding') out.set(String(r['connectorId']), [...(out.get(String(r['connectorId'])) ?? []), r]);
  return out;
}

/** The bindings of the document's connector `doc` and the base's `own`, paired by end. */
function bindingAlias(
  index: { readonly base: Map<string, Rec[]>; readonly doc: Map<string, Rec[]> },
  pair: { readonly own: string; readonly doc: string },
): [string, string][] {
  const found: [string, string][] = [];
  const mine = index.base.get(pair.own) ?? [];
  for (const b of index.doc.get(pair.doc) ?? []) {
    const twin = mine.find((r) => r['end'] === b['end']);
    if (twin !== undefined && twin.id !== b.id) found.push([twin.id, b.id]);
  }
  return found;
}

/** The edges: those of the base and the document that join the same two nodes, the nth to the nth, and their bindings. */
function edgeAlias(base: Recs, doc: Recs, screen: string, nodes: ReadonlyMap<string, string>): Map<string, string> {
  const docToBase = new Map([...nodes].map(([b, d]) => [d, b] as const));
  const mine = connectorsByEnds(base, undefined, (id) => id);
  const theirs = connectorsByEnds(doc, screen, (id) => docToBase.get(id) ?? id);
  const index = { base: bindingsByConnector(base), doc: bindingsByConnector(doc) };
  const out = new Map<string, string>();
  for (const [key, list] of mine) {
    (theirs.get(key) ?? []).forEach((connector, i) => {
      const own = list[i];
      if (own === undefined) return;
      if (own.id !== connector.id) out.set(own.id, connector.id);
      for (const [from, to] of bindingAlias(index, { own: own.id, doc: connector.id })) out.set(from, to);
    });
  }
  return out;
}

/** What `aliasOf` reads. */
export type AliasInput = {
  /** The owned records of the base compile. */
  readonly base: Recs;
  /** Every record of the document the text was made from. */
  readonly doc: Recs;
  /** The slug that document's decompile wrote for each of its nodes and groups. */
  readonly slugs: ReadonlyMap<string, string>;
  /** The shown screen's id in the document. */
  readonly screen: string;
};

/**
 * The id in the document of each record of the base compile, where it is not the same.
 *
 * @param input - the base, the document, its slugs and the shown screen
 * @returns base id to document id
 */
export function aliasOf(input: AliasInput): Map<string, string> {
  const { base, doc, slugs, screen } = input;
  const out = new Map<string, string>();
  const screens = Object.values(base).filter((r) => r.type === 'screen');
  const [only] = screens;
  if (screens.length === 1 && only !== undefined && only.id !== screen) out.set(only.id, screen);
  const nodes = nodeAlias(base, doc, slugs);
  for (const [k, v] of [...nodes, ...edgeAlias(base, doc, screen, nodes)]) out.set(k, v);
  return out;
}
