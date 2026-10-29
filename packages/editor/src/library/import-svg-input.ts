// The members of a studio SVG import (M18.175, NFR-SEC-001): picked files or one ZIP, read within the batch bounds. Files are
// counted and sized from their listed `size` before any `bytes()` call; a ZIP's own size is checked before it is read, then its
// entry count and declared sizes from the central directory before any entry is inflated (format's `zipMembers`).
import { escapes, INPUT_LIMITS, type SvgBatchFile, type SvgMemberProblem, zipMembers } from '@fluxion/format';
import { err, ok, type Result } from '@fluxion/schema';

/** One picked item; a `File` fits. @public */
export type SvgLibraryItem = {
  /** The member path: a file name, or a `/`-separated relative path. */
  readonly name: string;
  /** The listed byte size, checked before the bytes are read. */
  readonly size: number;
  /** Reads the bytes; called only once every bound has passed. */
  readonly bytes: () => Promise<Uint8Array>;
};

/** What the user picked: SVG files, or one ZIP of them. @public */
export type SvgLibraryInput = {
  /** `files`: each item is a member; `zip`: the one item is an archive of members. */
  readonly kind: 'files' | 'zip';
  /** The picked items. */
  readonly items: readonly SvgLibraryItem[];
};

/** The first bound the listed sizes pass, before anything is read. */
function oversized(items: readonly SvgLibraryItem[]): SvgMemberProblem | undefined {
  if (items.length > INPUT_LIMITS.maxEntries) return { path: '', message: `more than ${INPUT_LIMITS.maxEntries} entries` };
  const big = items.find((item) => !(item.size <= INPUT_LIMITS.maxEntryBytes));
  if (big) return { path: big.name, message: 'entry exceeds 128 MiB' };
  const total = items.reduce((sum, item) => sum + item.size, 0);
  return total > INPUT_LIMITS.maxTotalBytes ? { path: '', message: 'inputs exceed 256 MiB' } : undefined;
}

/** The bytes of `item`, refused when they are not its listed size (it changed after it was listed). */
async function read(item: SvgLibraryItem): Promise<Uint8Array | undefined> {
  const bytes = await item.bytes();
  return bytes.byteLength === item.size ? bytes : undefined;
}

/** The members of one picked ZIP: its own size checked before it is read. */
async function zipped(items: readonly SvgLibraryItem[]): Promise<SvgBatchFile[] | SvgMemberProblem> {
  const [zip, ...extra] = items;
  if (zip === undefined || extra.length) return { path: '', message: 'a ZIP import takes exactly one file' };
  if (!(zip.size <= INPUT_LIMITS.maxTotalBytes)) return { path: '', message: 'ZIP file exceeds 256 MiB' };
  const bytes = await read(zip);
  return bytes === undefined ? { path: '', message: 'ZIP file changed while it was read' } : zipMembers(bytes);
}

/** The members of `input`, in code-unit path order; or the problems met (every escaping name, else the first bound), no bytes read past a failed bound. */
export async function readLibraryMembers(input: SvgLibraryInput): Promise<Result<SvgBatchFile[], readonly SvgMemberProblem[]>> {
  if (input.kind === 'zip') {
    const members = await zipped(input.items);
    return Array.isArray(members) ? ok(members) : err([members]);
  }
  const escaping = input.items.filter((item) => escapes(item.name));
  if (escaping.length) return err(escaping.map((item) => ({ path: item.name, message: 'escapes the input: an absolute, backslash, empty, `.` or `..` name' })));
  const problem = oversized(input.items);
  if (problem) return err([problem]);
  const files: SvgBatchFile[] = [];
  for (const item of [...input.items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const bytes = await read(item);
    if (bytes === undefined) return err([{ path: item.name, message: 'changed while it was read' }]);
    files.push({ path: item.name, bytes });
  }
  return ok(files);
}
