// The rights of a `pack-import` (ADR-0206): declared per member, never inferred. A `--credits` file names the pack's license and
// attribution and scoped credits that each list their members; the flag form is the one-credit shorthand covering every member.
// Hashes are declared, never computed from the input, so a folder and a ZIP of the same members give the same pack.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ShapePackCredit, ShapePackSource } from '@fluxion/sdk';
import { z } from 'zod';

/** The declared rights of an import: the pack's own, and one credit per member. */
export type ImportRights = {
  /** SPDX expression of the pack. */
  readonly license: string;
  /** Attribution of the pack. */
  readonly attribution: string;
  /** Credits without scopes, in declared order; `scoped` adds them. */
  readonly credits: readonly Omit<ShapePackCredit, 'definitionIds'>[];
  /** The credit id of each member path, or undefined when one credit covers every member. */
  readonly memberCredit?: ReadonlyMap<string, string>;
};

const sourceSchema = z.union([
  z.object({ kind: z.literal('original'), author: z.string().min(1), statement: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('upstream'),
      reference: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      revision: z.string().optional(),
      modifications: z.string().optional(),
    })
    .strict(),
]);
const creditsFileSchema = z
  .object({
    license: z.string().min(1),
    attribution: z.string().min(1),
    credits: z
      .array(
        z
          .object({
            id: z.string().min(1),
            license: z.string().min(1),
            attribution: z.string().min(1),
            notice: z.string().min(1).optional(),
            noticeFile: z.string().min(1).optional(),
            source: sourceSchema,
            members: z.array(z.string().min(1)).min(1),
          })
          .strict()
          .refine((c) => (c.notice === undefined) !== (c.noticeFile === undefined), 'give exactly one of notice and noticeFile'),
      )
      .min(1),
  })
  .strict();

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

/** A credit's notice: inline, or read from its file relative to the credits file; undefined when that cannot be read. */
async function noticeOf(c: { readonly notice?: string | undefined; readonly noticeFile?: string | undefined }, path: string): Promise<string | undefined> {
  if (c.noticeFile === undefined) return c.notice;
  try {
    return await readFile(resolve(dirname(path), c.noticeFile), 'utf8');
  } catch {
    return undefined;
  }
}

/** The rights a `--credits` file declares, or why it is not one. Notice files are read relative to the credits file. */
export async function fileRights(path: string): Promise<ImportRights | string> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return `cannot read --credits ${path} as JSON`;
  }
  const parsed = creditsFileSchema.safeParse(json);
  if (!parsed.success) return `--credits ${path}: ${parsed.error.issues.map((i) => `${i.path.join('/')} ${i.message}`).join('; ')}`;
  const memberCredit = new Map<string, string>();
  const credits: Omit<ShapePackCredit, 'definitionIds'>[] = [];
  for (const c of parsed.data.credits) {
    for (const member of c.members) {
      const earlier = memberCredit.get(member);
      if (earlier !== undefined) return `${member} is in credits ${earlier} and ${c.id}; each member needs exactly one`;
      memberCredit.set(member, c.id);
    }
    const notice = await noticeOf(c, path);
    if (notice === undefined) return `cannot read notice file ${c.noticeFile} of credit ${c.id}`;
    credits.push({ id: c.id, license: c.license, attribution: c.attribution, notice, source: c.source as ShapePackSource });
  }
  return { license: parsed.data.license, attribution: parsed.data.attribution, credits, memberCredit };
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The credits scoped to the definitions of their members (`idOf` by member path), or the members no credit names. The flag
 * form's one credit covers every definition, so it is not scoped: undefined, and the pack's own credit is that one.
 */
export function scopedCredits(rights: ImportRights, idOf: ReadonlyMap<string, string>): ShapePackCredit[] | undefined | string {
  const { memberCredit } = rights;
  if (memberCredit === undefined) return undefined;
  const uncredited = [...idOf.keys()].filter((path) => !memberCredit.has(path));
  if (uncredited.length) return `no credit names ${uncredited.join(', ')}`;
  const unknown = [...memberCredit.keys()].filter((path) => !idOf.has(path));
  if (unknown.length) return `credits name ${unknown.join(', ')}, which the input does not hold`;
  return rights.credits.map((c) => ({
    ...c,
    // in code-unit order of id, never in read order, so a folder and a ZIP of the same members give the same bytes
    definitionIds: [...idOf]
      .filter(([path]) => memberCredit.get(path) === c.id)
      .map(([, id]) => id)
      .sort(byCodeUnit) as unknown as ShapePackCredit['definitionIds'],
  })) as ShapePackCredit[];
}
