// Pack connector types in a saved file (FR-CON-010, FR-LIB-009, ADR-0048 amendment M18.112): the definitions of the pack
// connector types a document's connectors use travel as `connectors/<pack>.json` entries, each a `fluxion-connector-defs`
// envelope, so a reader without the pack registers them on open (routing `registerConnectorDefs`) and draws the same
// decoration. The entries are ordinary extra entries: the container and document schema are unchanged.
import { type ConnectorDef, canonicalJson, describeOf, parseConnectorDefs } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { decodeUtf8Strict, encodeUtf8 } from './utf8.js';

/**
 * Where a file keeps its pack connector types: `connectors/<pack>.json`.
 *
 * @public
 */
export const CONNECTOR_ENTRY_PREFIX = 'connectors/';

/** Most bytes one embedded `connectors/<pack>.json` entry may have when read back. */
const MAX_ENTRY_BYTES = 1 << 20;

/** The pack of the qualified type `type`. */
const packOf = (type: string): string => type.slice(0, type.indexOf(':'));

/**
 * The pack connector types (qualified route types) `document`'s connectors use, sorted.
 *
 * @public
 */
export function usedConnectorTypes(document: DocumentFile): readonly string[] {
  const types = new Set<string>();
  for (const record of Object.values(document.records) as { readonly kind?: unknown; readonly route?: { readonly type?: unknown } }[]) {
    const type = record.kind === 'connector' ? record.route?.type : undefined;
    if (typeof type === 'string' && type.includes(':')) types.add(type);
  }
  return [...types].sort();
}

/** `definitions` as a `connectors/<pack>.json` entry: a 1.0 envelope in canonical JSON, definitions in id order. */
const entryOf = (definitions: readonly unknown[]): Uint8Array =>
  encodeUtf8(canonicalJson({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [...definitions].sort(byId) }));

const idOf = (def: unknown): unknown => (typeof def === 'object' && def !== null ? (def as { readonly id?: unknown }).id : undefined);
const byId = (a: unknown, b: unknown): number => (String(idOf(a)) < String(idOf(b)) ? -1 : 1);

/**
 * Whether `def` is a definition of `pack` that routing's `registerConnectorDefs` takes whatever host reads it back: a valid
 * 1.0 definition (`parseConnectorDefs`) whose `describe`, if any, is one catalog line (`describeOf`). Its base router is
 * one of the built-in routers, which every host registers.
 */
const registrable = (def: unknown, pack: string): boolean =>
  parseConnectorDefs({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [def] }, pack).ok &&
  ((def as { readonly describe?: unknown }).describe === undefined || describeOf(def) !== undefined);

/** What `carried` took from an earlier entry: the definitions that join the new entry, and the used ids it had to drop. */
type Carried = { readonly definitions: readonly unknown[]; readonly dropped: readonly string[] };

/**
 * The definitions of `earlier` (the file's `connectors/<pack>.json`, of any envelope version) whose ids are in `ids` and
 * that every host registers (`registrable`), at most one per id (the first), so they can join a 1.0 entry this host reads
 * back; none when it is not JSON. `dropped` lists, sorted, each id of `ids` that `earlier` defines but none of whose
 * definitions could be carried (M18.260).
 */
function carried(earlier: Uint8Array | undefined, ids: ReadonlySet<string>, pack: string): Carried {
  const input = earlier === undefined ? undefined : readEntry(earlier);
  const definitions = typeof input === 'object' && input !== null ? (input as { readonly definitions?: unknown }).definitions : undefined;
  if (!Array.isArray(definitions)) return { definitions: [], dropped: [] };
  const taken = new Set<unknown>();
  const seen = new Set<string>();
  const kept = definitions.filter((def) => {
    const id = idOf(def);
    if (typeof id !== 'string' || !ids.has(id)) return false;
    seen.add(id);
    if (taken.has(id)) return false;
    const valid = registrable(def, pack);
    if (valid) taken.add(id);
    return valid;
  });
  return { definitions: kept, dropped: [...seen].filter((id) => !taken.has(id)).sort() };
}

/**
 * The entry a save writes for `pack`, whose used types are `types` with the host's definitions `defs` (`undefined` where
 * the host does not know the type): every known definition, with `earlier`'s definitions of the unknown types; when the
 * host knows none of them, `earlier` as it was (none when there is none).
 */
function packEntry(
  pack: string,
  types: readonly string[],
  defs: readonly (ConnectorDef | undefined)[],
  earlier: Uint8Array | undefined,
): { readonly entry: Uint8Array | undefined; readonly dropped: readonly string[] } {
  const known = defs.filter((def): def is ConnectorDef => def !== undefined);
  if (known.length === 0) return { entry: earlier, dropped: [] };
  const unknown = new Set(types.filter((_, i) => defs[i] === undefined));
  const kept = carried(earlier, unknown, pack);
  return { entry: entryOf([...known, ...kept.definitions]), dropped: kept.dropped };
}

/**
 * The extra entries a save of `document` writes: `entries` (the file's) with its `connectors/` entries replaced by one
 * `connectors/<pack>.json` per pack the document's connectors use, in canonical JSON with definitions in id order. It
 * holds every used type `defOf` (the host's registered types) knows, and the file's earlier definitions of the used types
 * it does not know (M18.239), so a reader without the pack draws the known types and an entry this host refused on open
 * keeps its types; a pack none of whose used types `defOf` knows keeps the file's entry as it was. An earlier definition
 * that is not a valid 1.0 definition, has a describe registering refuses, or repeats an id cannot join the 1.0 entry and
 * is not carried: `onDropped` is called once per pack with the used type ids whose earlier definitions were all dropped,
 * sorted, so the host can say so (M18.260). Entries of packs the document no longer uses are dropped.
 *
 * @public
 */
export function savedConnectorEntries(
  document: DocumentFile,
  entries: ReadonlyMap<string, Uint8Array> | undefined,
  defOf: (type: string) => ConnectorDef | undefined,
  onDropped?: (pack: string, ids: readonly string[]) => void,
): ReadonlyMap<string, Uint8Array> {
  const held = entries ?? new Map<string, Uint8Array>();
  const out = new Map([...held].filter(([name]) => !name.startsWith(CONNECTOR_ENTRY_PREFIX)));
  const byPack = new Map<string, string[]>();
  for (const type of usedConnectorTypes(document)) byPack.set(packOf(type), [...(byPack.get(packOf(type)) ?? []), type]);
  for (const [pack, types] of [...byPack].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = `${CONNECTOR_ENTRY_PREFIX}${pack}.json`;
    const { entry, dropped } = packEntry(pack, types, types.map(defOf), held.get(name));
    if (entry !== undefined) out.set(name, entry);
    if (dropped.length > 0) onDropped?.(pack, dropped);
  }
  return out;
}

/** The JSON of one entry's bytes, or `undefined` when it is over 1 MiB or not UTF-8 JSON. */
function readEntry(bytes: Uint8Array): unknown {
  const text = bytes.byteLength > MAX_ENTRY_BYTES ? undefined : decodeUtf8Strict(bytes);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * One embedded `connectors/<pack>.json` entry read back: its pack and its parsed JSON (`undefined` when it is over 1 MiB or
 * not UTF-8 JSON), for routing's `registerConnectorDefs`, which validates it and refuses it whole.
 *
 * @public
 */
export type EmbeddedConnectors = {
  /** The pack, from the entry name. */
  readonly pack: string;
  /** The entry's JSON, unvalidated. */
  readonly input: unknown;
};

/**
 * The `connectors/<pack>.json` entries of `entries` (a loaded file's extra entries), in name order.
 *
 * @public
 */
export function embeddedConnectors(entries: ReadonlyMap<string, Uint8Array> | undefined): readonly EmbeddedConnectors[] {
  return [...(entries ?? [])]
    .filter(([name]) => name.startsWith(CONNECTOR_ENTRY_PREFIX) && name.endsWith('.json') && !name.slice(CONNECTOR_ENTRY_PREFIX.length).includes('/'))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, bytes]) => ({ pack: name.slice(CONNECTOR_ENTRY_PREFIX.length, -'.json'.length), input: readEntry(bytes) }));
}
