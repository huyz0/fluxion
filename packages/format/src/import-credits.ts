// The declared rights of an SVG pack import (ADR-0206), shared by `fluxion pack-import --credits` and the studio (M18.17): the
// credits file schema, each member in exactly one credit, and the credits scoped to their members' definitions. Rights are
// declared, never inferred; hosts read any notice files the credits name and pass their texts in.

import type { ShapePackCredit, ShapePackSource } from '@fluxion/core';
import { z } from 'zod';

/** The declared rights of an import: the pack's own, and one credit per member. @public */
export type ImportRights = {
  /** SPDX expression of the pack. */
  readonly license: string;
  /** Attribution of the pack. */
  readonly attribution: string;
  /** Credits without scopes, in declared order; {@link scopedCredits} adds them. */
  readonly credits: readonly Omit<ShapePackCredit, 'definitionIds'>[];
  /** The credit id of each member path, or undefined when one credit covers every member. */
  readonly memberCredit?: ReadonlyMap<string, string>;
};

/** One credit of a credits file as declared: its notice inline or in a file the host reads. @public */
export type DeclaredImportCredit = Omit<ShapePackCredit, 'definitionIds' | 'notice'> & {
  /** The notice text, when inline. */
  readonly notice?: string | undefined;
  /** The notice file, relative to the credits file, when not inline. */
  readonly noticeFile?: string | undefined;
  /** The member paths the credit covers. */
  readonly members: readonly string[];
};

/** A validated credits file, before its notice files are read. @public */
export type DeclaredImportCredits = {
  /** SPDX expression of the pack. */
  readonly license: string;
  /** Attribution of the pack. */
  readonly attribution: string;
  /** The credits, each member in exactly one. */
  readonly credits: readonly DeclaredImportCredit[];
  /** The notice files the credits name, in declared order, each once. */
  readonly noticeFiles: readonly string[];
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

/** Why a credits file is not a declaration: its schema issues (joined), or a member in two credits. @public */
export type ImportCreditsProblem = {
  /** `schema`: the file is not a credits file; `member`: a member is in two credits. */
  readonly kind: 'schema' | 'member';
  /** What is wrong. */
  readonly message: string;
};

/**
 * A credits file's JSON value as declared credits, or why it is not one: the schema's issues, or a member in two credits.
 * @public
 */
export function parseImportCredits(json: unknown): DeclaredImportCredits | ImportCreditsProblem {
  const parsed = creditsFileSchema.safeParse(json);
  if (!parsed.success) return { kind: 'schema', message: parsed.error.issues.map((i) => `${i.path.join('/')} ${i.message}`).join('; ') };
  const owner = new Map<string, string>();
  for (const c of parsed.data.credits)
    for (const member of c.members) {
      const earlier = owner.get(member);
      if (earlier !== undefined) return { kind: 'member', message: `${member} is in credits ${earlier} and ${c.id}; each member needs exactly one` };
      owner.set(member, c.id);
    }
  const noticeFiles = [...new Set(parsed.data.credits.flatMap((c) => (c.noticeFile === undefined ? [] : [c.noticeFile])))];
  return { ...parsed.data, credits: parsed.data.credits as DeclaredImportCredit[], noticeFiles };
}

/**
 * The rights `declared` gives once every notice file has its text in `notices`; a credit whose file has none is refused, naming
 * the credit and the file.
 * @public
 */
export function withNotices(declared: DeclaredImportCredits, notices: ReadonlyMap<string, string>): ImportRights | string {
  const memberCredit = new Map<string, string>();
  const credits: Omit<ShapePackCredit, 'definitionIds'>[] = [];
  for (const c of declared.credits) {
    for (const member of c.members) memberCredit.set(member, c.id);
    const notice = c.noticeFile === undefined ? c.notice : notices.get(c.noticeFile);
    if (notice === undefined) return `cannot read notice file ${c.noticeFile} of credit ${c.id}`;
    credits.push({ id: c.id, license: c.license, attribution: c.attribution, notice, source: c.source as ShapePackSource });
  }
  return { license: declared.license, attribution: declared.attribution, credits, memberCredit };
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The credits scoped to the definitions of their members (`idOf` by member path), or the members no credit names. The one-credit
 * form covers every definition, so it is not scoped: undefined, and the pack's own credit is that one.
 * @public
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
