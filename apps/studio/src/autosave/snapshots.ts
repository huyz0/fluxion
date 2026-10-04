// Version snapshots (FR-FIL-007, ADR-0024): a full `.flux` written on each explicit save and after every 10 minutes of editing with changes; the
// newest `VERSION_SNAPSHOTS` stay. A convenience on top of saving the file, so a failing write is reported to the caller, never thrown into editing.
import type { BlobStore } from './blobs.js';

/**
 * How many snapshots of one document are kept.
 *
 * @public
 */
export const VERSION_SNAPSHOTS = 20;
/**
 * Editing time between two automatic snapshots.
 *
 * @public
 */
export const SNAPSHOT_INTERVAL_MS: number = 10 * 60 * 1000;

const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.flux$/;

/** Letters, digits and `-_` stay; every other character becomes `.` plus its code in hex, so two ids never share a directory. */
function dirOf(docId: string): string {
  const safe = [...docId].map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : `.${(c.codePointAt(0) ?? 0).toString(16)}.`)).join('');
  return `versions/${safe === '' ? '.0.' : safe}`;
}

/**
 * One kept version.
 *
 * @public
 */
export type SnapshotInfo = {
  /** The file name, which sorts in time order. */
  readonly name: string;
  /** When it was written, ISO 8601. */
  readonly at: string;
};

function nameOf(iso: string): string {
  return `${iso.replace(/:/g, '-')}.flux`;
}

function isoOf(name: string): string {
  return name.slice(0, -'.flux'.length).replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
}

/**
 * The snapshots of one document, newest first.
 *
 * @public
 */
export async function listSnapshots(blobs: BlobStore, docId: string): Promise<readonly SnapshotInfo[]> {
  const names = (await blobs.list(dirOf(docId))).filter((n) => NAME.test(n)).sort();
  return names.reverse().map((name) => ({ name, at: isoOf(name) }));
}

/**
 * Write `flux` (the bytes of a whole `.flux`) as the version at `iso`, then remove the oldest beyond `VERSION_SNAPSHOTS`. Two writes in the same
 * millisecond are one version.
 *
 * @public
 */
export async function writeSnapshot(blobs: BlobStore, docId: string, iso: string, flux: Uint8Array): Promise<SnapshotInfo> {
  const dir = dirOf(docId);
  const name = nameOf(iso);
  if (!NAME.test(name)) throw new RangeError(`not an ISO 8601 UTC time with milliseconds: ${iso}`);
  await blobs.put(`${dir}/${name}`, flux);
  const all = await listSnapshots(blobs, docId);
  for (const old of all.slice(VERSION_SNAPSHOTS)) await blobs.remove(`${dir}/${old.name}`);
  return { name, at: iso };
}

/**
 * The bytes of one snapshot, or undefined.
 *
 * @public
 */
export async function readSnapshot(blobs: BlobStore, docId: string, name: string): Promise<Uint8Array | undefined> {
  if (!NAME.test(name)) throw new RangeError(`not a snapshot name: ${name}`);
  return blobs.get(`${dirOf(docId)}/${name}`);
}

/**
 * Whether an automatic snapshot is due: the document has changes since the last version and `SNAPSHOT_INTERVAL_MS` has passed since `lastAt` (the last version, or the time the document was opened).
 *
 * @public
 */
export function snapshotDue(lastAt: number, now: number, changed: boolean): boolean {
  return changed && now - lastAt >= SNAPSHOT_INTERVAL_MS;
}
