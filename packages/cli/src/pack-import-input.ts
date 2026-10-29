// The members of a `pack-import` input (ADR-0206), read within the batch bounds before any of them is converted: a folder is
// walked with `lstat` (no symlink, device or other non-regular entry; sizes checked before reading), a ZIP's own size is checked
// before it is read and its entries listed once under `importSvgBatch`'s limits with strict names. Ids and categories come from
// member paths by one slug rule; an empty or invalid id and two members with one id are refused, naming the paths.

import type { Stats } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readZip, type SvgBatchFile } from '@fluxion/format';
import { qualifiedNameSchema } from '@fluxion/schema';

/** The bounds every input shares with `importSvgBatch` (ADR-0188). */
export const INPUT_LIMITS: { readonly maxEntries: number; readonly maxEntryBytes: number; readonly maxTotalBytes: number } = Object.freeze({
  maxEntries: 4096,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

/** A refusal of the input: what is wrong, and the member path it concerns ('' for the whole input). */
export type InputProblem = { readonly path: string; readonly message: string };

const isSvg = (path: string) => /\.svg$/i.test(path);

type Found = { readonly path: string; readonly abs: string; readonly size: number };

/** One entry of a walk: a nested folder is listed, a regular file is kept, anything else is refused. */
async function visit(path: string, abs: string, found: Found[]): Promise<InputProblem | undefined> {
  const stat: Stats = await lstat(abs);
  if (stat.isSymbolicLink()) return { path, message: 'is a symbolic link; pack-import never follows links' };
  if (stat.isDirectory()) return list(abs, `${path}/`, found);
  if (!stat.isFile()) return { path, message: 'is not a regular file' };
  found.push({ path, abs, size: stat.size });
  return found.length > INPUT_LIMITS.maxEntries ? { path: '', message: `more than ${INPUT_LIMITS.maxEntries} entries` } : undefined;
}

/** Lists the regular files under `dir` into `found` (each folder in name order), stopping at a link, a non-regular entry or the entry cap. */
async function list(dir: string, prefix: string, found: Found[]): Promise<InputProblem | undefined> {
  for (const name of (await readdir(dir)).sort()) {
    const problem = await visit(`${prefix}${name}`, join(dir, name), found);
    if (problem) return problem;
  }
  return undefined;
}

/** The first entry over the per-entry cap, or the total over the input cap, from the listed sizes before anything is read. */
function oversized(found: readonly Found[]): InputProblem | undefined {
  const big = found.find((f) => f.size > INPUT_LIMITS.maxEntryBytes);
  if (big) return { path: big.path, message: 'entry exceeds 128 MiB' };
  const total = found.reduce((sum, f) => sum + f.size, 0);
  return total > INPUT_LIMITS.maxTotalBytes ? { path: '', message: 'inputs exceed 256 MiB' } : undefined;
}

/** The regular members of `root`, by `/`-separated relative path in code-unit order, or the first problem met. */
async function walk(root: string): Promise<SvgBatchFile[] | InputProblem> {
  const found: Found[] = [];
  const problem = (await list(root, '', found)) ?? oversized(found);
  if (problem) return problem;
  // the batch orders by path; the listing is sorted the same way (code units over the whole path, not per folder)
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: SvgBatchFile[] = [];
  for (const f of found) {
    const bytes = await readListed(f);
    if (bytes === undefined) return { path: f.path, message: 'changed while it was read' };
    files.push({ path: f.path, bytes });
  }
  return files;
}

/**
 * The bytes of a listed member, opened without following a link and read to at most one byte past its listed size; undefined
 * when it is no longer the regular file of that size, so a member swapped after listing is refused, never read in full.
 */
async function readListed(f: Found): Promise<Uint8Array | undefined> {
  const handle = await open(f.abs, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== f.size) return undefined;
    const buffer = new Uint8Array(f.size + 1);
    let filled = 0;
    for (let n = -1; n !== 0 && filled < buffer.length; filled += n) n = (await handle.read(buffer, filled, buffer.length - filled, filled)).bytesRead;
    return filled === f.size ? buffer.subarray(0, f.size) : undefined;
  } finally {
    await handle.close();
  }
}

/** Whether a ZIP member name could name a file outside the input; checked again by `importSvgBatch`, refused here before any conversion. */
const escapes = (name: string): boolean => /^\/|^[A-Za-z]:|\\/.test(name) || name.split('/').some((s) => s === '' || s === '.' || s === '..');

/** The regular members of a ZIP file, its own size checked before reading. */
async function unzip(file: string, size: number): Promise<SvgBatchFile[] | InputProblem> {
  if (size > INPUT_LIMITS.maxTotalBytes) return { path: '', message: 'ZIP file exceeds 256 MiB' };
  const bytes = await readListed({ path: '', abs: file, size });
  if (bytes === undefined) return { path: '', message: 'ZIP file changed while it was read' };
  const zip = readZip(bytes, { ...INPUT_LIMITS, strictNames: true });
  if (!zip.ok) return { path: '', message: `ZIP refused: ${zip.error.reason}` };
  const members = zip.value.filter((e) => !e.name.endsWith('/'));
  const escaping = members.find((e) => escapes(e.name));
  if (escaping) return { path: escaping.name, message: 'escapes the input: an absolute, backslash, empty, `.` or `..` name' };
  return members.map((e) => ({ path: e.name, bytes: e.bytes }));
}

/** The members of `input` (a folder or a `.zip` file), or why it cannot be read within the bounds. */
export async function readMembers(input: string): Promise<SvgBatchFile[] | InputProblem> {
  let stat: Stats;
  try {
    stat = await lstat(input);
  } catch {
    return { path: '', message: `cannot read ${input}` };
  }
  try {
    if (stat.isDirectory()) return await walk(input);
    if (stat.isFile() && /\.zip$/i.test(input)) return await unzip(input, stat.size);
  } catch {
    return { path: '', message: `cannot read ${input}` };
  }
  return { path: '', message: `${input} is neither a folder nor a .zip file` };
}

/** `a/b/My Icon.svg` → `my-icon`: lowercased basename without `.svg`, each run outside `[a-z0-9]` one `-`, trimmed. */
export function slugOf(path: string): string {
  const base = (path.split('/').at(-1) ?? '').replace(/\.svg$/i, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A member's category text: its directory, or `uncategorized` at the root. */
export const categoryOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'uncategorized');

/** The id of every member in `namespace`, or every problem: a non-SVG member, an empty or invalid id, two members with one id. */
export function memberIds(files: readonly SvgBatchFile[], namespace: string): Map<string, string> | InputProblem[] {
  const problems: InputProblem[] = [];
  const ids = new Map<string, string>();
  const owner = new Map<string, string>();
  for (const { path } of files) {
    if (!isSvg(path)) {
      problems.push({ path, message: 'is not an SVG; every member of a pack-import must be one' });
      continue;
    }
    const id = `${namespace}:${slugOf(path)}`;
    if (slugOf(path) === '' || !qualifiedNameSchema.safeParse(id).success) {
      problems.push({ path, message: `its name gives no valid definition id ("${id}")` });
      continue;
    }
    const earlier = owner.get(id);
    if (earlier !== undefined) problems.push({ path, message: `gives the id ${id}, as ${earlier} does` });
    else owner.set(id, path);
    ids.set(path, id);
  }
  return problems.length ? problems : ids;
}
