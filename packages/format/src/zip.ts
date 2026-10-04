// The zip container of `.flux` (architecture/08 §2): entries written in the order given, a fixed timestamp, no extra fields, so the
// same entries give the same bytes (FR-FIL-003); read back with every entry's size and CRC-32 checked and the output capped
// (FR-FIL-009). No zip64: an archive of 65 535 entries or 4 GB is refused. Path policy (`..`, absolute, duplicate names) is the loader's.
import { err, ok, type Result } from '@fluxion/schema';
import { crc32 } from './crc32.js';
import { deflateRaw } from './deflate.js';
import { inflateRaw } from './inflate.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/**
 * How an entry is stored: deflated, or as it is.
 *
 * @public
 */
export type ZipMethod = 'deflate' | 'store';

/**
 * An entry to write.
 *
 * @public
 */
export type ZipInput = {
  /** The path inside the archive, `/`-separated. */
  readonly name: string;
  /** The entry's bytes. */
  readonly bytes: Uint8Array;
  /** `store` keeps the bytes; `deflate` (the default) deflates them unless that is no smaller. */
  readonly method?: ZipMethod;
};

/**
 * An entry read.
 *
 * @public
 */
export type ZipEntry = {
  /** The path inside the archive. */
  readonly name: string;
  /** The entry's bytes, inflated and checked. */
  readonly bytes: Uint8Array;
  /** How the archive stored it. */
  readonly method: ZipMethod;
};

/**
 * Why an archive was refused.
 *
 * @public
 */
export type ZipFailure = {
  /** What is wrong, for a diagnostic. */
  readonly reason: string;
  /** `limit` when a limit stopped the read (entry count, sizes, memory), `invalid` when the archive is damaged or unsupported. */
  readonly kind: 'invalid' | 'limit';
};

/**
 * What `readZip` allows.
 *
 * @public
 */
export type ZipLimits = {
  /** The most entries (default 4096). */
  readonly maxEntries?: number;
  /** The most bytes of any one entry once inflated (default 256 MB). */
  readonly maxEntryBytes?: number;
  /** The most bytes of all entries together once inflated (default 512 MB). */
  readonly maxTotalBytes?: number;
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
/** Bit 11 of the flags: names are UTF-8. */
const FLAG_UTF8 = 0x0800;
/** 1980-01-01 00:00:00 in MS-DOS date and time. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;
const VERSION = 20;
const U16 = 0xffff;
const U32 = 0xffffffff;

const failure = (reason: string, kind: ZipFailure['kind'] = 'invalid'): Result<never, ZipFailure> => err({ reason, kind });

/** The local file header of an entry (30 bytes and its name). */
function localHeader(name: Uint8Array, e: { readonly method: number; readonly crc: number; readonly packed: number; readonly size: number }): Uint8Array {
  const out = new Uint8Array(30 + name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_LOCAL, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, FLAG_UTF8, true);
  v.setUint16(8, e.method, true);
  v.setUint16(10, DOS_TIME, true);
  v.setUint16(12, DOS_DATE, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, e.packed, true);
  v.setUint32(22, e.size, true);
  v.setUint16(26, name.length, true);
  out.set(name, 30);
  return out;
}

/** The central directory header of an entry whose local header is at `offset`. */
function centralHeader(
  name: Uint8Array,
  e: { readonly method: number; readonly crc: number; readonly packed: number; readonly size: number; readonly offset: number },
): Uint8Array {
  const out = new Uint8Array(46 + name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_CENTRAL, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, VERSION, true);
  v.setUint16(8, FLAG_UTF8, true);
  v.setUint16(10, e.method, true);
  v.setUint16(12, DOS_TIME, true);
  v.setUint16(14, DOS_DATE, true);
  v.setUint32(16, e.crc, true);
  v.setUint32(20, e.packed, true);
  v.setUint32(24, e.size, true);
  v.setUint16(28, name.length, true);
  v.setUint32(42, e.offset, true);
  out.set(name, 46);
  return out;
}

/** The end-of-central-directory record. */
function endRecord(count: number, directory: number, offset: number): Uint8Array {
  const out = new Uint8Array(22);
  const v = new DataView(out.buffer);
  v.setUint32(0, SIG_END, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, directory, true);
  v.setUint32(16, offset, true);
  return out;
}

/** `parts` joined into one array. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** What goes into the archive for `entry`: its bytes as stored, and the method (8 deflate, 0 store; deflate only when smaller). */
function packEntry(entry: ZipInput): { readonly body: Uint8Array; readonly method: number } {
  const packed = entry.method === 'store' ? undefined : deflateRaw(entry.bytes);
  return packed !== undefined && packed.length < entry.bytes.length ? { body: packed, method: 8 } : { body: entry.bytes, method: 0 };
}

/** Why `entry` cannot be written, if it cannot. */
function entryProblem(entry: ZipInput, name: Uint8Array): string | undefined {
  if (name.length === 0 || name.length > U16) return `an entry name of ${name.length} bytes`;
  return entry.bytes.length > U32 ? `${entry.name}: larger than 4 GB` : undefined;
}

/**
 * Write `entries` as a zip, in the order given: byte-identical for identical input.
 *
 * @public
 */
export function writeZip(entries: readonly ZipInput[]): Result<Uint8Array, ZipFailure> {
  if (entries.length > U16) return failure(`${entries.length} entries: a zip holds at most ${U16} without zip64`);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encodeUtf8(entry.name);
    const problem = entryProblem(entry, name);
    if (problem !== undefined) return failure(problem);
    const { body, method } = packEntry(entry);
    const meta = { method, crc: crc32(entry.bytes), packed: body.length, size: entry.bytes.length };
    const local = localHeader(name, meta);
    parts.push(local, body);
    central.push(centralHeader(name, { ...meta, offset }));
    offset += local.length + body.length;
    if (offset > U32) return failure('the archive is larger than 4 GB');
  }
  const directory = central.reduce((n, c) => n + c.length, 0);
  return ok(concat([...parts, ...central, endRecord(entries.length, directory, offset)]));
}

/** The offset of the end-of-central-directory record, searched back from the end over the longest comment a zip allows. */
function findEnd(view: DataView): number {
  const stop = Math.max(0, view.byteLength - 22 - U16);
  for (let at = view.byteLength - 22; at >= stop; at--) if (view.getUint32(at, true) === SIG_END) return at;
  return -1;
}

/** One central directory record, read. */
type Listing = {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly packed: number;
  readonly size: number;
  readonly local: number;
  /** Where the next record starts. */
  readonly next: number;
};

/** The central directory record at `at`, or why it is damaged. */
function listingAt(bytes: Uint8Array, view: DataView, at: number): Result<Listing, ZipFailure> {
  if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG_CENTRAL) return failure('the central directory is damaged');
  const nameLength = view.getUint16(at + 28, true);
  if (at + 46 + nameLength > bytes.length) return failure('the central directory is damaged');
  return ok({
    name: decodeUtf8(bytes.subarray(at + 46, at + 46 + nameLength)),
    method: view.getUint16(at + 10, true),
    crc: view.getUint32(at + 16, true),
    packed: view.getUint32(at + 20, true),
    size: view.getUint32(at + 24, true),
    local: view.getUint32(at + 42, true),
    next: at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true),
  });
}

/** The stored bytes of the entry `item` describes, found through its local header, which must agree with the central directory. */
function locate(bytes: Uint8Array, view: DataView, item: Listing): Result<Uint8Array, ZipFailure> {
  const { name, method, packed, local } = item;
  if (method !== 0 && method !== 8) return failure(`${name}: compression method ${method} is not supported`);
  if (local + 30 > bytes.length || view.getUint32(local, true) !== SIG_LOCAL) return failure(`${name}: its local header is missing`);
  // the local header must say what the central directory says, or two readers see two archives
  const localName = decodeUtf8(bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)));
  if (localName !== name || view.getUint16(local + 8, true) !== method) return failure(`${name}: its local header names another entry or method`);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  if (start + packed > bytes.length) return failure(`${name}: its data runs past the end of the file`);
  return ok(bytes.subarray(start, start + packed));
}

/** The entry `item` describes: its bytes located, inflated and checked. */
function entryOf(bytes: Uint8Array, view: DataView, item: Listing): Result<ZipEntry, ZipFailure> {
  const { name, method, packed, size } = item;
  const body = locate(bytes, view, item);
  if (!body.ok) return body;
  if (method === 0 && packed !== size) return failure(`${name}: a stored entry whose sizes differ`);
  const inflated = method === 0 ? ok(body.value) : inflateRaw(body.value, size);
  if (!inflated.ok) return failure(`${name}: ${inflated.error.reason}`, inflated.error.kind);
  if (inflated.value.length !== size) return failure(`${name}: ${inflated.value.length} bytes where ${size} were declared`);
  if (crc32(inflated.value) !== item.crc) return failure(`${name}: its checksum does not match`);
  return ok({ name, bytes: inflated.value.slice(), method: method === 0 ? 'store' : 'deflate' });
}

/** `entryOf`, with an allocation the host refuses (a very large declared size) as a failure, not a throw. */
function entryOrFailure(bytes: Uint8Array, view: DataView, item: Listing): Result<ZipEntry, ZipFailure> {
  try {
    return entryOf(bytes, view, item);
  } catch (e) {
    if (e instanceof RangeError) return failure(`${item.name}: the host cannot hold ${item.size} bytes`, 'limit');
    throw e;
  }
}

/**
 * Read every entry of the zip `bytes`, inflated and checked. A fault is a `reason`; nothing throws.
 *
 * @public
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = {}): Result<ZipEntry[], ZipFailure> {
  const { maxEntries = 4096, maxEntryBytes = 256 * 1024 * 1024, maxTotalBytes = 512 * 1024 * 1024 } = limits;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length < 22 ? -1 : findEnd(view);
  if (end < 0) return failure('no zip end record');
  const count = view.getUint16(end + 10, true);
  if (count > maxEntries) return failure(`${count} entries (more than ${maxEntries})`, 'limit');
  const entries: ZipEntry[] = [];
  let at = view.getUint32(end + 16, true);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const item = listingAt(bytes, view, at);
    if (!item.ok) return item;
    if (item.value.size > maxEntryBytes) return failure(`${item.value.name}: ${item.value.size} bytes inflated (more than ${maxEntryBytes})`, 'limit');
    total += item.value.size;
    if (total > maxTotalBytes) return failure(`the entries inflate to more than ${maxTotalBytes} bytes`, 'limit');
    const entry = entryOrFailure(bytes, view, item.value);
    if (!entry.ok) return entry;
    entries.push(entry.value);
    at = item.value.next;
  }
  return ok(entries);
}
