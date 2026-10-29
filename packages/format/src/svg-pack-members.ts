// The members of an SVG pack import (ADR-0206), shared by `fluxion pack-import` and the studio (M18.17): the batch bounds, one slug
// rule naming every member's id and category, and a ZIP listed once under those bounds with escaping names refused, all before any
// member is converted. Pure: hosts read the bytes, checking sizes first.

import { qualifiedNameSchema } from '@fluxion/schema';
import type { SvgBatchFile } from './svg-batch.js';
import { readZip } from './zip.js';

/** The bounds every input shares with `importSvgBatch` (ADR-0188). @public */
export const INPUT_LIMITS: {
  /** The most members. */
  readonly maxEntries: number;
  /** The most bytes of one member. */
  readonly maxEntryBytes: number;
  /** The most bytes of all members together. */
  readonly maxTotalBytes: number;
} = Object.freeze({
  maxEntries: 4096,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

/** A refusal of an import input: what is wrong, and the member path it concerns ('' for the whole input). @public */
export type SvgMemberProblem = {
  /** The member path it concerns, or '' for the whole input. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
};

const isSvg = (path: string) => /\.svg$/i.test(path);

/** Whether a member name could name a file outside the input: absolute, a drive letter, a backslash, an empty, `.` or `..` segment. @public */
export const escapes = (name: string): boolean => /^\/|^[A-Za-z]:|\\/.test(name) || name.split('/').some((s) => s === '' || s === '.' || s === '..');

/**
 * The regular members of the ZIP `bytes`, listed once under {@link INPUT_LIMITS} with strict names (entry count and declared sizes
 * refused from the central directory before any entry is inflated), directory entries dropped and escaping names refused. The
 * host checks the ZIP's own size before reading it.
 * @public
 */
export function zipMembers(bytes: Uint8Array): SvgBatchFile[] | SvgMemberProblem {
  const zip = readZip(bytes, { ...INPUT_LIMITS, strictNames: true });
  if (!zip.ok) return { path: '', message: `ZIP refused: ${zip.error.reason}` };
  const members = zip.value.filter((e) => !e.name.endsWith('/'));
  const escaping = members.find((e) => escapes(e.name));
  if (escaping) return { path: escaping.name, message: 'escapes the input: an absolute, backslash, empty, `.` or `..` name' };
  return members.map((e) => ({ path: e.name, bytes: e.bytes }));
}

/** `a/b/My Icon.svg` → `my-icon`: lowercased basename without `.svg`, each run outside `[a-z0-9]` one `-`, trimmed. @public */
export function slugOf(path: string): string {
  const base = (path.split('/').at(-1) ?? '').replace(/\.svg$/i, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A member's category text: its directory, or `uncategorized` at the root. @public */
export const categoryOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'uncategorized');

/**
 * The id of every member in `namespace` by member path, or every problem: a non-SVG member, an empty or invalid id, two members
 * with one id, each naming its path.
 * @public
 */
export function memberIds(files: readonly { readonly path: string }[], namespace: string): Map<string, string> | SvgMemberProblem[] {
  const problems: SvgMemberProblem[] = [];
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
