// Embed on save (FR-AST-006, architecture/08 §6): an asset record that names a `source` URL is fetched through the `FileIO` port, checked
// against the hash the record pins, sanitised like any imported image, kept once in the store by its hash, and the record then holds the
// bytes' hash and no `source`. A file written after this renders with the network blocked.
import type { FileIO } from '@fluxion/core';
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import type { AssetStore } from './asset-store.js';
import type { ContentHasher, FluxAsset } from './flux-writer.js';
import { MAX_IMPORT_BYTES } from './image-import.js';
import { type ImageInfo, sniffImage } from './image-sniff.js';
import { sanitizeAsset } from './sanitize-asset.js';

/**
 * The hash an author writes for an external asset whose bytes they have not pinned: 64 zeros. Any other hash is checked against the fetched bytes.
 *
 * @public
 */
export const UNPINNED_HASH: string = '0'.repeat(64);

/**
 * A stable code for an external asset that could not be embedded (add, never rename).
 *
 * @public
 */
export type EmbedFailureCode = 'EMBED_URL_REFUSED' | 'EMBED_FETCH_FAILED' | 'EMBED_TOO_LARGE' | 'EMBED_NOT_AN_IMAGE' | 'EMBED_INTEGRITY';

/**
 * One external asset that stayed external.
 *
 * @public
 */
export type EmbedFailure = {
  /** The asset record's id. */
  readonly id: string;
  /** Its `source` URL. */
  readonly url: string;
  /** Stable machine-readable code. */
  readonly code: EmbedFailureCode;
  /** One line for the person. */
  readonly message: string;
};

/**
 * What embedding found.
 *
 * @public
 */
export type EmbedResult = {
  /** The document with each embedded record holding its bytes' hash, size and media type, and no `source`. */
  readonly document: DocumentFile;
  /** Ids of the asset records that were embedded. */
  readonly embedded: readonly string[];
  /** The records that could not be: the file is not offline-safe while this is not empty. */
  readonly failures: readonly EmbedFailure[];
};

/**
 * What embedding needs.
 *
 * @public
 */
export type EmbedInput = {
  /** The document whose external asset records to embed. */
  readonly document: DocumentFile;
  /** Where the bytes are kept; bytes already held (the same hash) are held once. */
  readonly store: AssetStore;
  /** Reads a URL as a path: the host's fetch (the studio's `fetch`, a test double). */
  readonly io: Pick<FileIO, 'read'>;
  /** Hashes the bytes. */
  readonly hasher: ContentHasher;
};

type External = { readonly id: string; readonly record: AnyRecord & { readonly source: string; readonly hash: string } };

const fail = (e: External, code: EmbedFailureCode, message: string): { readonly failure: EmbedFailure } => ({
  failure: { id: e.id, url: e.record.source, code, message },
});

/** The WHATWG URL parser (pure: no I/O), named here because this package builds without DOM or Node types. */
declare const URL: new (url: string) => { readonly protocol: string; readonly username: string; readonly password: string; readonly hostname: string };

/** Host names that mean this machine or a private network. */
const PRIVATE_NAME = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp)$/;

/** Whether the dotted IPv4 address `host` is loopback, private, link-local, shared (CGNAT), benchmarking, multicast or reserved. */
function privateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/**
 * Whether `url` is one a save may fetch: an absolute https URL to a public host, without credentials (a port is allowed). The URL is parsed
 * first, so numeric forms (`2130706433`, `0x7f.1`), a trailing dot (`localhost.`) and IPv6 literals (including IPv4-mapped ones) are judged by
 * the host they mean, not the text they were written with. The check is textual: a public name that resolves to a private address, and
 * DNS rebinding, are not caught (the fetch runs in the person's browser, with credentials omitted and no redirects).
 */
function fetchable(url: string): boolean {
  let u: InstanceType<typeof URL>;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return false;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === '' || host.startsWith('[') || !host.includes('.')) return false;
  return !PRIVATE_NAME.test(host) && !privateIPv4(host);
}

/** The asset records that name a `source`. */
function externals(doc: DocumentFile): External[] {
  const out: External[] = [];
  for (const [id, record] of Object.entries(doc.records)) {
    const r = record as { readonly type: string; readonly source?: unknown; readonly hash?: unknown };
    if (r.type === 'asset' && typeof r.source === 'string' && typeof r.hash === 'string') out.push({ id, record: record as External['record'] });
  }
  return out;
}

/** The embedded record: bytes' hash, size and media type in, the source out. */
function embeddedRecord(e: External, kept: { readonly hash: string; readonly asset: FluxAsset }, size: ImageInfo): AnyRecord {
  const { source: _source, ...rest } = e.record as AnyRecord & { source: string };
  const { width, height } = size;
  return {
    ...rest,
    hash: kept.hash,
    mime: kept.asset.mime,
    size: kept.asset.bytes.length,
    ...(width === undefined ? {} : { w: width }),
    ...(height === undefined ? {} : { h: height }),
  } as AnyRecord;
}

/** Fetch, check and keep one external asset: the new record, or why not. */
async function embedOne(e: External, input: EmbedInput): Promise<{ readonly record: AnyRecord } | { readonly failure: EmbedFailure }> {
  const { source, hash } = e.record;
  if (!fetchable(source)) return fail(e, 'EMBED_URL_REFUSED', `${source} is not an https address of a public host`);
  const read = await input.io.read(source);
  if (!read.ok) return fail(e, 'EMBED_FETCH_FAILED', `${source} could not be fetched (blocked, offline or not found)`);
  if (read.value.length > MAX_IMPORT_BYTES) return fail(e, 'EMBED_TOO_LARGE', `${source} is larger than ${MAX_IMPORT_BYTES} bytes`);
  if (hash !== UNPINNED_HASH && (await input.hasher.sha256(read.value)) !== hash)
    return fail(e, 'EMBED_INTEGRITY', `${source} no longer has the bytes the file pins`);
  const info = sniffImage(read.value);
  if (info === undefined) return fail(e, 'EMBED_NOT_AN_IMAGE', `${source} is not a PNG, JPEG, WebP, AVIF, GIF or SVG image`);
  const clean = sanitizeAsset({ bytes: read.value, mime: info.mime });
  if (clean === undefined) return fail(e, 'EMBED_NOT_AN_IMAGE', `${source} is an SVG that cannot be drawn safely`);
  return { record: embeddedRecord(e, { hash: await input.store.put(clean.bytes, clean.mime), asset: clean }, info) };
}

/**
 * Embeds every external asset record of `input.document`: the bytes of each `source` URL are fetched through `io`, pinned records are checked
 * against their hash, the bytes are sanitised and kept in `store` (the same bytes once, however many records name them), and the record
 * holds the hash and no `source`. A record that cannot be embedded stays as it was and is listed in `failures`; the rest still embed. Records
 * with bytes already (no `source`) are left alone.
 *
 * @param input - the document, the store, the fetch port and the hasher
 * @returns the document to save, the ids embedded and the failures
 * @public
 */
export async function embedExternalAssets(input: EmbedInput): Promise<EmbedResult> {
  const records = { ...input.document.records };
  const embedded: string[] = [];
  const failures: EmbedFailure[] = [];
  for (const e of externals(input.document)) {
    const done = await embedOne(e, input);
    if ('failure' in done) failures.push(done.failure);
    else {
      records[e.id] = done.record;
      embedded.push(e.id);
    }
  }
  return { document: { ...input.document, records }, embedded, failures };
}
