// The rights of a `pack-import` (ADR-0206): declared per member, never inferred. A `--credits` file names the pack's license and
// attribution and scoped credits that each list their members; the flag form is the one-credit shorthand covering every member.
// Hashes are declared, never computed from the input, so a folder and a ZIP of the same members give the same pack.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type ImportRights, parseImportCredits, withNotices } from '@fluxion/format';
import type { ShapePackSource } from '@fluxion/sdk';

export { type ImportRights, scopedCredits } from '@fluxion/format';

/** The rights the flags declare, or why they are not a complete declaration. */
export async function flagRights(values: Record<string, unknown>): Promise<ImportRights | string> {
  const text = (name: string) => (typeof values[name] === 'string' && values[name] !== '' ? (values[name] as string) : undefined);
  const [license, attribution, author, upstream, sha256, noticeFile] = ['license', 'attribution', 'author', 'upstream', 'upstream-sha256', 'notice-file'].map(
    text,
  );
  if (license === undefined || attribution === undefined) return 'pack-import needs --credits <file.json>, or --license and --attribution';
  if ((author === undefined) === (upstream === undefined)) return 'give exactly one of --author and --upstream';
  if (upstream !== undefined && !/^[0-9a-f]{64}$/.test(sha256 ?? ''))
    return '--upstream needs --upstream-sha256 <64 lowercase hex>, the declared hash of the source';
  const source: ShapePackSource =
    author !== undefined
      ? { kind: 'original', author, statement: `Original work of ${author}.` }
      : { kind: 'upstream', reference: upstream as string, sha256: sha256 as string };
  let notice = `${attribution}, licensed ${license}.`;
  if (noticeFile !== undefined) {
    try {
      notice = await readFile(noticeFile, 'utf8');
    } catch {
      return `cannot read --notice-file ${noticeFile}`;
    }
  }
  return { license, attribution, credits: [{ id: 'source', license, attribution, notice, source }] };
}

/** The rights a `--credits` file declares, or why it is not one. Notice files are read relative to the credits file. */
export async function fileRights(path: string): Promise<ImportRights | string> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return `cannot read --credits ${path} as JSON`;
  }
  const declared = parseImportCredits(json);
  if ('kind' in declared) return declared.kind === 'schema' ? `--credits ${path}: ${declared.message}` : declared.message;
  const notices = new Map<string, string>();
  for (const file of declared.noticeFiles) {
    try {
      notices.set(file, await readFile(resolve(dirname(path), file), 'utf8'));
    } catch {
      // withNotices names the credit whose file cannot be read
    }
  }
  return withNotices(declared, notices);
}
