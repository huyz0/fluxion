// Did-you-mean for FluxScript diagnostics (FR-DSL-006, 06-ai-authoring.md §3 resolve): the nearest known name by edit distance (optimal
// string alignment: insert, delete, substitute, swap neighbours), and a valid slug made from a name that breaks the slug rule.

/**
 * The optimal-string-alignment distance between `a` and `b`: insertions, deletions, substitutions and swaps of neighbours.
 *
 * @public
 */
export function editDistance(a: string, b: string): number {
  const [x, y] = [[...a], [...b]];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number) => d[i]?.[j] ?? 0;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      (d[i] as number[])[j] = best;
    }
  }
  return at(x.length, y.length);
}

/**
 * The candidate nearest to `word` (case ignored), when it is within a third of the word's length in edits (at least 1, at most 3) and
 * not the word itself (the same name in other case is a suggestion); the first such candidate in `candidates`' order on a tie.
 *
 * @public
 */
export function nearest(word: string, candidates: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  const reach = Math.min(3, Math.max(1, Math.floor(w.length / 3)));
  let best: { readonly name: string; readonly distance: number } | undefined;
  for (const name of candidates) {
    const distance = editDistance(w, name.toLowerCase());
    // the word itself is no suggestion; the same name in other case is (`API` → `api`)
    if (name === word || distance > reach) continue;
    if (best === undefined || distance < best.distance) best = { name, distance };
  }
  return best?.name;
}

/**
 * `name` as a slug (`[a-z][a-z0-9-]*`): lower-cased, every run of other characters one `-`, leading digits and dashes and a trailing
 * dash dropped; undefined when no letter is left to start it.
 *
 * @public
 */
export function toSlug(name: string): string | undefined {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '');
  return slug === '' ? undefined : slug;
}
