// The text to canvas half of the source view (FR-EDT-022, ADR-0032): the screen's FluxScript generated, compiled on its own, and its change since the base
// merged into the document as one `document.applyRecords` (merge.ts). Pure of CodeMirror and React. Lazy chunk: it imports `@fluxion/dsl`.
import { type CoreRegistries, resolveSalt, type Store } from '@fluxion/core';
import { compile, type DslDiagnostic, decompile } from '@fluxion/dsl';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import type { Execute } from '../pointer.js';
import { aliasOf } from './alias.js';
import { type MergeConflict, mergeOwned, type Recs } from './merge.js';
import type { Rec } from './remap.js';

/** The undo merge key of one apply. */
const MERGE_KEY = 'source-view.apply';

/** What one try at applying the text came to. */
export type SyncResult = {
  /** `applied` (the canvas changed, one undo step), `unchanged` (the text compiles to what the document holds), `invalid` (errors: nothing applied) or `refused` (the store refused the write). */
  readonly status: 'applied' | 'unchanged' | 'invalid' | 'refused';
  /** Every diagnostic of the compile, warnings included. */
  readonly diagnostics: readonly DslDiagnostic[];
  /** Why the store refused the write. */
  readonly problem?: string;
  /** The records the canvas changed that the text overwrote (both changed the same field since the base). */
  readonly conflicts?: readonly MergeConflict[];
  /** How many records the view does not own were removed or lost a reference because the element they pointed at was deleted. */
  readonly dependents?: number;
  /** Slugs of removed nodes the merge could not pair with an added one, whose comments or canvas fields were lost with them. */
  readonly unpaired?: readonly string[];
  /** Each document id the apply changed (a renamed slug, a record made by hand), to the id it became. */
  readonly remap?: ReadonlyMap<RecordId, RecordId>;
  /** The compile of the text, to be the next base (present when the text was applied or already up to date). */
  readonly base?: Base;
};

/** What the text of a screen was made from: the document at that moment and the slug each of its elements was written with. */
export type Generated = {
  /** The FluxScript. */
  readonly text: string;
  /** The document it was made from. */
  readonly doc: DocumentFile;
  /** The slug of each node and group of the document. */
  readonly slugs: ReadonlyMap<RecordId, string>;
};

/** The FluxScript of one screen, and what it was made from. */
export function generate(store: Store, registries: CoreRegistries, screen: RecordId): Generated {
  const doc = store.toDocument();
  const made = decompile(doc, { registries, screens: [screen] });
  return { text: made.text, doc, slugs: made.slugs };
}

/** The FluxScript of one screen: the header and its block. */
export function sourceOf(store: Store, registries: CoreRegistries, screen: RecordId): string {
  return generate(store, registries, screen).text;
}

/** Whether a diagnostic stops the apply: warnings (the deferred sections the compiler keeps but does not compile) do not. */
export const blocks = (d: DslDiagnostic): boolean => d.severity === 'error';

/** The text as last generated or applied, compiled: the records the source owns (the base of the three-way merge, ADR-0032). */
export type Base = {
  /** The records of the compile that are the source's: the screen, its elements and their bindings (not the document or the theme). */
  readonly records: Recs;
  /** The document id of each record whose id there is not the one it has here (made by hand, with a random id). */
  readonly alias: ReadonlyMap<string, string>;
};

type Loose = { readonly [key: string]: unknown };
const NOT_OWNED: ReadonlySet<string> = new Set(['document', 'theme']);

const saltOf = (doc: DocumentFile): string =>
  resolveSalt(Object.values(doc.records).find((r) => r.type === 'document') as { readonly source?: { readonly salt?: unknown } } | undefined);

/** `text` compiled on its own with the document's salt (so its ids are the ones a compile into the document gives), and the records it owns. */
function compileOwned(
  text: string,
  registries: CoreRegistries,
  doc: DocumentFile,
): { readonly diagnostics: readonly DslDiagnostic[]; readonly records: Recs | undefined } {
  const result = compile(text, { registries, salt: saltOf(doc) });
  const records =
    result.doc === undefined
      ? undefined
      : Object.fromEntries(
          Object.values(result.doc.records)
            .filter((r) => !NOT_OWNED.has(r.type))
            .map((r) => [r.id, r as Rec]),
        );
  return { diagnostics: result.diagnostics, records };
}

/** The base of a text that was generated from `gen` for `screen` (undefined: the text does not compile; there is nothing to merge against). */
export function baseOf(text: string, registries: CoreRegistries, gen: Generated, screen: RecordId): Base | undefined {
  const { records } = compileOwned(text, registries, gen.doc);
  return records === undefined ? undefined : { records, alias: aliasOf({ base: records, doc: gen.doc.records as unknown as Recs, slugs: gen.slugs, screen }) };
}

/** The base when the caller has none: the document as it is now is taken to be what the text was written from (a text applied on its own). */
function currentBase(next: Recs, registries: CoreRegistries, store: Store): Base | undefined {
  const compiled = Object.values(next).find((r) => r.type === 'screen');
  const slug = ((compiled?.['meta'] ?? {}) as Loose)['slug'];
  const shown = Object.values(store.toDocument().records).find(
    (r) => r.type === 'screen' && (r.id === compiled?.id || ((r as Loose)['meta'] as Loose | undefined)?.['slug'] === slug),
  );
  if (shown === undefined) return undefined;
  const gen = generate(store, registries, shown.id);
  return baseOf(gen.text, registries, gen, shown.id);
}

/** Whether the document shows something the text does not say: the owned records of what the document generates now differ from `base`'s (order aside). */
export function drifted(store: Store, registries: CoreRegistries, screen: RecordId, base: Base | undefined): boolean {
  if (base === undefined || store.get(screen) === undefined) return false;
  const gen = generate(store, registries, screen);
  const now = compileOwned(gen.text, registries, gen.doc).records;
  if (now === undefined) return false;
  const plain = (r: Rec): string => JSON.stringify({ ...r, index: undefined });
  const [a, b] = [Object.keys(now), Object.keys(base.records)];
  return a.length !== b.length || a.some((id) => base.records[id] === undefined || plain(now[id] as Rec) !== plain(base.records[id] as Rec));
}

/** The document a text is applied to: the store, the only write path, and the registries the compile reads. */
export type SourceTarget = { readonly store: Store; readonly execute: Execute; readonly registries: CoreRegistries };

/** Compile `text` and write what its change since `base` came to, as one command and one undo step (the three-way merge of ADR-0032). */
export function applyMerged(text: string, target: SourceTarget, base?: Base): SyncResult {
  const { store, execute, registries } = target;
  const doc = store.toDocument();
  const { diagnostics, records: next } = compileOwned(text, registries, doc);
  if (next === undefined || diagnostics.some(blocks)) return { status: 'invalid', diagnostics };
  const before = base ?? currentBase(next, registries, store) ?? { records: {}, alias: new Map<string, string>() };
  const merged = mergeOwned({ base: before.records, next, current: doc.records as unknown as Recs, alias: before.alias });
  const after: Base = { records: next, alias: new Map() };
  if (merged.puts.length === 0 && merged.deletes.length === 0) return { status: 'unchanged', diagnostics, base: after };
  // each apply is its own undo step: not merged into the edit before it, nor into the next apply
  store.history.seal();
  const written = execute('document.applyRecords', { puts: merged.puts, deletes: merged.deletes }, { mergeKey: MERGE_KEY });
  store.history.seal();
  if (!written.ok) return { status: 'refused', diagnostics, problem: written.error.message };
  return {
    status: 'applied',
    diagnostics,
    conflicts: merged.conflicts,
    dependents: merged.dependents,
    unpaired: merged.unpaired,
    remap: merged.remap as ReadonlyMap<RecordId, RecordId>,
    base: after,
  };
}

/** {@link applyMerged} with the document taken as the base: the text is applied on its own, the canvas being what the text was written from. */
export function applySource(text: string, store: Store, execute: Execute, registries: CoreRegistries): SyncResult {
  return applyMerged(text, { store, execute, registries });
}
