// The package an SVG export carries in `<metadata>` (ADR-0056 item 7, FR-EXP-004): the exported screen as a `.flux`, with the
// records it needs and nothing of another screen. Kept are the document record, the screen, its applied master and their elements,
// then, to a fixed point, every other record they name (a theme, an asset) and every other record that names one of them and nothing
// dropped (a connector's binding). The payload is base64 in a `fluxion:package` element with its SHA-256; one over
// SVG_PACKAGE_MAX_BYTES is left out.
import { sha256Hex } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';

/**
 * The largest package an SVG export embeds, in bytes (2 MiB, the PNG `iTXt` bound of 10 §6).
 *
 * @public
 */
export const SVG_PACKAGE_MAX_BYTES: number = 2 * 1024 * 1024;

/** The XML namespace of the package element. */
export const PACKAGE_NS = 'https://fluxion.dev/ns/svg/1';

type Fields = { readonly [key: string]: unknown };

/** The record ids `value` names, at any depth. */
function named(value: unknown, ids: ReadonlySet<string>, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (ids.has(value)) out.add(value);
  } else if (Array.isArray(value)) for (const v of value) named(v, ids, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) named(v, ids, out);
  return out;
}

/** Whether `record` is placed on a screen or is one (what an export keeps only for its own screens). */
const placed = (record: Fields): boolean => record['type'] === 'screen' || record['type'] === 'element';

/** The ids `records` keeps for `screens` at first: the document record, the screens and their elements (on `pruned`, `only`'s). */
function placedIds(
  records: { readonly [id: string]: Fields },
  screens: ReadonlySet<string>,
  only?: { readonly pruned: string; readonly ids: ReadonlySet<string> },
): Set<string> {
  const kept = new Set<string>();
  for (const [id, r] of Object.entries(records)) {
    const screen = String(r['screenId']);
    const own = r['type'] === 'element' && screens.has(screen) && (only === undefined || screen !== only.pruned || only.ids.has(id));
    if (r['type'] === 'document' || screens.has(id) || own) kept.add(id);
  }
  // a kept member names its parent: the parent chain stays (without its other members), so the package reopens unrepaired
  for (const id of [...kept]) {
    for (let parent = records[id]?.['parentId']; typeof parent === 'string' && !kept.has(parent) && records[parent] !== undefined; ) {
      kept.add(parent);
      parent = records[parent]?.['parentId'];
    }
  }
  return kept;
}

/**
 * `file` pruned to what screen `screenId` (and its applied master `master`) need: their records and the closure of the records they
 * name and that name them, never another screen or anything on one. With `only` (a selection export), the screen keeps those of its
 * elements alone and their parent chains (a member names its parent); its master stays whole, as the screen names it.
 *
 * @public
 */
export function screenPackage(file: DocumentFile, screenId: RecordId, master?: RecordId, only?: ReadonlySet<RecordId>): DocumentFile {
  const records = file.records as unknown as { readonly [id: string]: Fields };
  const ids = new Set(Object.keys(records));
  const screens = new Set<string>([screenId, ...(master === undefined ? [] : [master])]);
  const kept = placedIds(records, screens, only === undefined ? undefined : { pruned: screenId, ids: only });
  const names = new Map(Object.entries(records).map(([id, r]) => [id, named(r, ids)]));
  const dropped = (id: string) => !kept.has(id) && placed(records[id] as Fields);
  const wanted = (id: string): boolean => {
    const own = [...(names.get(id) ?? [])];
    return [...kept].some((k) => names.get(k)?.has(id)) || (own.some((n) => kept.has(n)) && !own.some(dropped));
  };
  for (let grew = true; grew; ) {
    const more = Object.entries(records).filter(([id, r]) => !kept.has(id) && !placed(r) && wanted(id));
    for (const [id] of more) kept.add(id);
    grew = more.length > 0;
  }
  const out = Object.fromEntries(Object.entries(records).filter(([id]) => kept.has(id)));
  return { ...file, records: out as unknown as DocumentFile['records'] };
}

/** `text` with XML's five special characters escaped. */
export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The base64 text of `bytes` (RFC 4648, padded). */
export function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    parts.push(
      (ALPHABET[(n >> 18) & 63] as string) +
        (ALPHABET[(n >> 12) & 63] as string) +
        (left > 1 ? (ALPHABET[(n >> 6) & 63] as string) : '=') +
        (left > 2 ? (ALPHABET[n & 63] as string) : '='),
    );
  }
  return parts.join('');
}

/** The `<metadata>` of an export of `screen` (or a selection on it): the package `bytes`, or its omission (`too-large`, or none given). */
export function packageMetadata(input: {
  readonly bytes: Uint8Array | undefined;
  readonly schema: string;
  readonly screen: string;
  readonly omitted?: string;
  /** What was exported (default `screen`). */
  readonly scope?: 'screen' | 'selection';
}): string {
  const attrs = `xmlns:fluxion="${PACKAGE_NS}" media-type="application/vnd.fluxion+zip" schema="${escapeXml(input.schema)}" scope="${input.scope ?? 'screen'}" screen="${escapeXml(input.screen)}"`;
  if (input.bytes === undefined) return `<metadata><fluxion:package ${attrs} omitted="${escapeXml(input.omitted ?? 'none')}"/></metadata>`;
  return `<metadata><fluxion:package ${attrs} encoding="base64" sha256="${sha256Hex(input.bytes)}">${base64(input.bytes)}</fluxion:package></metadata>`;
}
