// What the decompiler knows of a document before writing it (FR-DSL-002, ADR-0031): its screens in order with their source ids, the
// elements of each screen in z-order, the bindings of each connector, the slug every element is written with (its own, else one made
// from its label, unique in the document, 02 §3), the packs its shapes come from, and the deferred sections by pointer.
import { type CoreRegistries, type SyncHash128, sha256Hash128 } from '@fluxion/core';
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { toSlug } from '../resolve/suggest.js';
import { plainText } from './values.js';

/** A record read loosely: any field may be there. */
export type Rec = AnyRecord & { readonly id: RecordId; readonly [key: string]: unknown };

/** An element: the fields the decompiler reads. */
export type El = Rec & {
  readonly kind: string;
  readonly screenId?: RecordId;
  readonly parentId?: RecordId;
  readonly index?: string;
  readonly semantic?: { readonly slug?: unknown; readonly label?: unknown };
};

export type Ctx = {
  readonly doc: DocumentFile;
  readonly registries: CoreRegistries;
  readonly hasher: SyncHash128;
  /** The id salt (ADR-0031). */
  readonly salt: string;
  /** The document record. */
  readonly meta: Rec | undefined;
  /** Screens in order. */
  readonly screens: readonly Rec[];
  /** The source id of each screen. */
  readonly screenIds: ReadonlyMap<RecordId, string>;
  /** The elements of each screen, in z-order. */
  readonly elements: ReadonlyMap<RecordId, readonly El[]>;
  /** The bindings of each connector, by end. */
  readonly bindings: ReadonlyMap<RecordId, { readonly source?: Rec; readonly target?: Rec }>;
  /** The slug of every element that can have one. */
  readonly slugs: ReadonlyMap<RecordId, string>;
  /** The packs of the shapes used, in order of first use. */
  readonly uses: readonly string[];
  /** Deferred sections by pointer, pointers sorted. */
  readonly deferred: readonly (readonly [string, string])[];
};

const SLUG = /^[a-z][a-z0-9-]*$/;
/** The slug of an element with neither slug nor label, by kind; `node` for the others. */
const SLUG_BASE: { readonly [kind: string]: string } = { group: 'group', text: 'text' };
/** Kinds that are nodes or groups in FluxScript, and so have a slug. */
export const SLUGGED: ReadonlySet<string> = new Set(['shape', 'text', 'group']);

const byIndex = (a: Rec, b: Rec) => {
  const [x, y] = [String(a['index'] ?? ''), String(b['index'] ?? '')];
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** `base`, else `base-2`, `base-3`… : the first one not taken, now taken. */
function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

/** Each item's own name when valid and first, else a unique name made by `fallback`. */
function names<T extends Rec>(items: readonly T[], own: (x: T) => unknown, fallback: (x: T) => string): Map<RecordId, string> {
  const taken = new Set<string>();
  const out = new Map<RecordId, string>();
  for (const x of items) {
    const name = own(x);
    if (typeof name === 'string' && SLUG.test(name) && !taken.has(name)) {
      taken.add(name);
      out.set(x.id, name);
    }
  }
  for (const x of items) if (!out.has(x.id)) out.set(x.id, unique(fallback(x), taken));
  return out;
}

/** Text a slug can be made from: an element's label, else its text. */
function labelOf(el: El): string {
  const label = el.semantic?.label;
  if (typeof label === 'string') return label;
  try {
    return plainText(el['text'] as never) ?? '';
  } catch {
    return '';
  }
}

function group<T>(items: readonly T[], key: (x: T) => unknown): Map<unknown, T[]> {
  const out = new Map<unknown, T[]>();
  for (const x of items) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
}

/** Each connector's bindings, by end. */
function bindingsOf(records: readonly Rec[]): Map<RecordId, { source?: Rec; target?: Rec }> {
  const out = new Map<RecordId, { source?: Rec; target?: Rec }>();
  for (const b of records.filter((r) => r.type === 'binding')) {
    const ends = out.get(b['connectorId'] as RecordId) ?? {};
    ends[b['end'] === 'source' ? 'source' : 'target'] = b;
    out.set(b['connectorId'] as RecordId, ends);
  }
  return out;
}

/** The packs of the shapes of `elements`, in order of first use. */
function packsOf(elements: readonly El[]): string[] {
  const packs = elements.flatMap((el) => (typeof el['defId'] === 'string' && el['defId'].includes(':') ? [el['defId'].split(':')[0] as string] : []));
  return [...new Set(packs)];
}

/** Everything the decompiler reads, indexed. */
export function contextOf(doc: DocumentFile, registries: CoreRegistries, hasher: SyncHash128 = sha256Hash128): Ctx {
  const records = Object.values(doc.records) as Rec[];
  const meta = records.find((r) => r.type === 'document');
  const source = meta?.['source'] as { readonly salt?: unknown; readonly deferred?: { readonly [p: string]: unknown } } | undefined;
  const screens = records.filter((r) => r.type === 'screen').sort(byIndex);
  const byScreen = group((records.filter((r) => r.type === 'element') as El[]).sort(byIndex), (el) => el.screenId);
  const elements = new Map(screens.map((s) => [s.id, byScreen.get(s.id) ?? []] as const));
  const ordered = screens.flatMap((s) => elements.get(s.id) ?? []);
  const slugged = ordered.filter((el) => SLUGGED.has(el.kind));
  const deferred = Object.entries(source?.deferred ?? {}).flatMap(([p, t]) => (typeof t === 'string' ? [[p, t] as const] : []));
  return {
    doc,
    registries,
    hasher,
    salt: typeof source?.salt === 'string' ? source.salt : '',
    meta,
    screens,
    screenIds: names(
      screens,
      (s) => (s['meta'] as { readonly slug?: unknown } | undefined)?.slug,
      (s) => toSlug(String(s['name'] ?? '')) ?? 'screen',
    ),
    elements,
    bindings: bindingsOf(records),
    slugs: names(
      slugged,
      (el) => el.semantic?.slug,
      (el) => toSlug(labelOf(el)) ?? SLUG_BASE[el.kind] ?? 'node',
    ),
    uses: packsOf(ordered),
    deferred: deferred.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}
