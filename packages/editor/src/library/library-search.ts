// The library's search index (FR-LIB-001, ADR-0021): lower-cased, accent-folded tokens of an entry's name, pack,
// category and keywords, in a sorted array answered by binary search. A query of several words keeps the entries that
// satisfy every word; a word matches a token exactly (best), as its prefix, or, when nothing has it as a prefix, inside
// it. Results rank by the sum of the words' matches, then by name. Pure; built once per set of packs.
import type { ShapeDef } from '@fluxion/core';

/**
 * What the library lists and searches: one shape definition's name, home and keywords.
 *
 * @public
 */
export type LibraryEntry = {
  /** The definition id, `pack:name`. */
  readonly id: string;
  /** The name people read, from the id. */
  readonly name: string;
  /** The pack that provides it. */
  readonly pack: string;
  /** Its category in the panel. */
  readonly category: string;
  /** Words that find it. */
  readonly keywords: readonly string[];
};

/**
 * A built index.
 *
 * @public
 */
export type LibraryIndex = {
  /** The entries matching `query` (every word of it), best first; every entry, by name, for a blank query. */
  search(query: string): readonly LibraryEntry[];
  /** How many entries it holds. */
  readonly size: number;
};

/**
 * The words of `text`: lower case, accents folded, split on anything that is not a letter or digit.
 *
 * @public
 */
export function tokensOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '');
}

/**
 * The entry for a shape definition: its name from the id after the pack, a title-cased `category` or `Other`.
 *
 * @public
 */
export function entryOf(def: ShapeDef): LibraryEntry {
  const colon = def.id.indexOf(':');
  const pack = colon < 0 ? '' : def.id.slice(0, colon);
  const raw = colon < 0 ? def.id : def.id.slice(colon + 1);
  const name = raw.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return { id: def.id, name, pack, category: def.category ?? 'Other', keywords: def.keywords ?? [] };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The first index in sorted `tokens` whose token is not below `key`. */
function lowerBound(tokens: readonly string[], key: string): number {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tokens[mid] as string) < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The token table: sorted unique tokens, and for each the entries holding it. */
function tableOf(entries: readonly LibraryEntry[]): { readonly tokens: string[]; readonly posting: number[][] } {
  const byToken = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const t of new Set([...tokensOf(e.name), ...tokensOf(e.pack), ...tokensOf(e.category), ...e.keywords.flatMap(tokensOf)])) {
      const list = byToken.get(t);
      if (list === undefined) byToken.set(t, [i]);
      else list.push(i);
    }
  });
  const tokens = [...byToken.keys()].sort(compare);
  return { tokens, posting: tokens.map((t) => byToken.get(t) as number[]) };
}

type Table = ReturnType<typeof tableOf>;

/** The entries `word` finds, each with its best rank (0 exact, 1 prefix, 2 inside a token). */
function wordMatches(table: Table, word: string): Map<number, number> {
  const { tokens, posting } = table;
  const found = new Map<number, number>();
  const add = (at: number, rank: number) => {
    for (const e of posting[at] as number[]) if ((found.get(e) ?? 9) > rank) found.set(e, rank);
  };
  for (let at = lowerBound(tokens, word); at < tokens.length && (tokens[at] as string).startsWith(word); at++) add(at, tokens[at] === word ? 0 : 1);
  // nothing begins with it: look inside the tokens
  if (found.size === 0) {
    for (const [at, t] of tokens.entries()) if (t.includes(word)) add(at, 2);
  }
  return found;
}

/** The entries both maps hold, with their ranks added. */
function both(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [e, rank] of a) {
    const other = b.get(e);
    if (other !== undefined) out.set(e, rank + other);
  }
  return out;
}

/**
 * Build the index of `entries`.
 *
 * @public
 */
export function buildLibraryIndex(entries: readonly LibraryEntry[]): LibraryIndex {
  const table = tableOf(entries);
  const byName = entries.map((_, i) => i).sort((a, b) => compare((entries[a] as LibraryEntry).name, (entries[b] as LibraryEntry).name) || a - b);
  return {
    size: entries.length,
    search(query) {
      const words = [...new Set(tokensOf(query))];
      if (words.length === 0) return byName.map((i) => entries[i] as LibraryEntry);
      let scores: Map<number, number> | undefined;
      for (const word of words) {
        const hit = wordMatches(table, word);
        scores = scores === undefined ? hit : both(scores, hit);
        if (scores.size === 0) return [];
      }
      return [...(scores as Map<number, number>)]
        .sort(([a, x], [b, y]) => x - y || compare((entries[a] as LibraryEntry).name, (entries[b] as LibraryEntry).name) || a - b)
        .map(([e]) => entries[e] as LibraryEntry);
    },
  };
}
