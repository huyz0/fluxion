// Pack connector types in a saved file (FR-CON-010, FR-LIB-009, ADR-0048 amendment M18.112): the definitions of the pack
// connector types a document's connectors use travel as `connectors/<pack>.json` entries, each a `fluxion-connector-defs`
// envelope, so a reader without the pack registers them on open (routing `registerConnectorDefs`) and draws the same
// decoration. The entries are ordinary extra entries: the container and document schema are unchanged.
import { type ConnectorDef, canonicalJson } from '@fluxion/core';
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

/**
 * The extra entries a save of `document` writes: `entries` (the file's) with its `connectors/` entries replaced by one
 * `connectors/<pack>.json` per pack whose used types `defOf` (the host's registered types) all knows, in canonical JSON
 * with definitions in id order. A pack with a used type `defOf` does not know keeps the file's entry as it was (one this
 * host refused on open survives the save, for a reader that can register it); entries of packs the document no longer
 * uses are dropped.
 *
 * @public
 */
export function savedConnectorEntries(
  document: DocumentFile,
  entries: ReadonlyMap<string, Uint8Array> | undefined,
  defOf: (type: string) => ConnectorDef | undefined,
): ReadonlyMap<string, Uint8Array> {
  const held = entries ?? new Map<string, Uint8Array>();
  const out = new Map([...held].filter(([name]) => !name.startsWith(CONNECTOR_ENTRY_PREFIX)));
  const byPack = new Map<string, (ConnectorDef | undefined)[]>();
  for (const type of usedConnectorTypes(document)) byPack.set(packOf(type), [...(byPack.get(packOf(type)) ?? []), defOf(type)]);
  for (const [pack, defs] of [...byPack].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = `${CONNECTOR_ENTRY_PREFIX}${pack}.json`;
    const known = defs.filter((def): def is ConnectorDef => def !== undefined);
    const earlier = held.get(name);
    if (known.length === defs.length) out.set(name, encodeUtf8(canonicalJson({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: known })));
    else if (earlier !== undefined) out.set(name, earlier);
  }
  return out;
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
    .map(([name, bytes]) => {
      const pack = name.slice(CONNECTOR_ENTRY_PREFIX.length, -'.json'.length);
      const text = bytes.byteLength > MAX_ENTRY_BYTES ? undefined : decodeUtf8Strict(bytes);
      if (text === undefined) return { pack, input: undefined };
      try {
        return { pack, input: JSON.parse(text) as unknown };
      } catch {
        return { pack, input: undefined };
      }
    });
}
