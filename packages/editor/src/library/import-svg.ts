// Studio SVG library import (FR-LIB-004, ADR-0206, M18.175): picked SVG files or one ZIP become one checked shape pack, or nothing.
// `convertSvgLibrary` registers nothing, so the dialog can convert again with mapped colors; `registerSvgLibrary` registers only
// the final pack. Order: bounded members and ids → declared rights and the license policy (before any witness) → every member
// witnessed through rotating sessions → all accepted or refused → `importedShapePack`. Rights are declared, never inferred.
import { allowsShapePackContentLicense, type ShapePackCredit, type ShapePackSource } from '@fluxion/core';
import {
  categoryOf,
  type DeclaredImportCredits,
  type ImportedPack,
  type ImportedPackEntry,
  type ImportedPackFont,
  type ImportRights,
  importedShapePack,
  importSvgBatch,
  memberIds,
  type SvgBatchFile,
  type SvgBatchReport,
  type SvgImportFont,
  type SvgMemberProblem,
  scopedCredits,
  type WitnessSessionPort,
  withNotices,
  witnessSessions,
} from '@fluxion/format';
import type { Diagnostic, Result, TokenRef } from '@fluxion/schema';
import { err, ok } from '@fluxion/schema';
import { type SvgBatchColors, svgBatchColors } from './import-svg-colors.js';
import { readLibraryMembers, type SvgLibraryInput } from './import-svg-input.js';

/**
 * The declared rights of an import: a credits file in the CLI format (its notices inline), or one credit covering every member,
 * the user's own work or a typed upstream source with its declared hash.
 * @public
 */
export type SvgLibraryRights =
  | {
      /** A parsed credits file (`parseImportCredits`); a credit naming a `noticeFile` is refused, since none is read here. */
      readonly kind: 'credits';
      /** The validated credits. */
      readonly credits: DeclaredImportCredits;
    }
  | {
      /** The user's own work. */
      readonly kind: 'original';
      /** SPDX expression; required, there is no default. */
      readonly license: string;
      /** Attribution preserved verbatim. */
      readonly attribution: string;
      /** The author's name. */
      readonly author: string;
    }
  | {
      /** Taken from an upstream source. */
      readonly kind: 'upstream';
      /** SPDX expression of the source; required. */
      readonly license: string;
      /** Attribution preserved verbatim. */
      readonly attribution: string;
      /** Where the source is; inert, never fetched. */
      readonly reference: string;
      /** The source's SHA-256 as the user declares it (64 lowercase hex); never computed here. */
      readonly sha256: string;
    };

/** A face the batch may draw text in: the witness's identity and the font's own declared rights. @public */
export type SvgLibraryFont = {
  /** The static face the witness was started with. */
  readonly face: SvgImportFont;
  /** Its bytes and rights, carried into a 1.1 pack when text needs it. */
  readonly rights: ImportedPackFont;
};

/** What a conversion needs: the pack identity, the declared rights, the colors to map and the host's witness and clock. @public */
export type SvgLibraryOptions = {
  /** Namespace of every definition; held namespaces are refused at registration. */
  readonly namespace: string;
  /** Exact semantic version. */
  readonly version: string;
  /** Display name. */
  readonly name: string;
  /** The declared rights. */
  readonly rights: SvgLibraryRights;
  /** Literal colors (as {@link svgBatchColors} offers them) to theme token references. */
  readonly colors?: Readonly<Record<string, TokenRef>>;
  /** The theme's color token references a mapped color may name. */
  readonly tokenRefs?: ReadonlySet<string>;
  /** Faces available to text; the first is the default where the SVG names none. */
  readonly fonts?: readonly SvgLibraryFont[];
  /** Starts one paint witness session (at most 128 requests, 120 s); the batch rotates them. */
  readonly startWitness: () => Promise<Result<WitnessSessionPort<readonly Diagnostic[]>, readonly Diagnostic[]>>;
  /** The host's clock in milliseconds, for session age. */
  readonly now: () => number;
};

/** A converted batch, registered nowhere yet. @public */
export type SvgLibraryConversion = SvgBatchColors & {
  /** The checked pack: its files, and the source a save retains. */
  readonly pack: ImportedPack;
  /** The batch report: `processed`, every member accepted. */
  readonly report: SvgBatchReport;
};

type Processed = Extract<SvgBatchReport, { readonly status: 'processed' }>;
const rejected = (problems: readonly SvgMemberProblem[]) => err(problems);
const whole = (message: string): SvgMemberProblem => ({ path: '', message });

/** The credit a one-credit declaration names as its source, or what it is missing. */
function sourceOf(rights: Exclude<SvgLibraryRights, { readonly kind: 'credits' }>): ShapePackSource | string {
  if (rights.kind === 'original')
    return rights.author.trim() === ''
      ? "give the author's name"
      : { kind: 'original', author: rights.author, statement: `Original work of ${rights.author}.` };
  if (rights.reference.trim() === '') return 'give where the source is';
  if (!/^[0-9a-f]{64}$/.test(rights.sha256)) return "give the source's SHA-256 as 64 lowercase hex";
  return { kind: 'upstream', reference: rights.reference, sha256: rights.sha256 };
}

/** The rights the declaration gives, or why it is not a complete one. */
function rightsOf(rights: SvgLibraryRights): ImportRights | string {
  if (rights.kind === 'credits') {
    const filed = rights.credits.credits.find((c) => c.noticeFile !== undefined);
    if (filed) return `credit ${filed.id} names the notice file ${filed.noticeFile}; give its notice inline`;
    return withNotices(rights.credits, new Map());
  }
  const { license, attribution } = rights;
  if (license.trim() === '') return 'give the license of the SVGs; there is no default';
  if (attribution.trim() === '') return 'give the attribution of the SVGs';
  const source = sourceOf(rights);
  if (typeof source === 'string') return source;
  return { license, attribution, credits: [{ id: 'source', license, attribution, notice: `${attribution}, licensed ${license}.`, source }] };
}

/** The batch report's refusals, each naming its member path; none when every member was accepted. */
function batchRefusals(report: SvgBatchReport): SvgMemberProblem[] {
  if (report.status === 'preflight-failed') return report.diagnostics.map((d) => whole(d.message));
  return report.inputs.flatMap((r) => (r.status === 'refused' ? r.diagnostics.map((d) => ({ path: r.path, message: d.message })) : []));
}

/** `a/My Icon.svg` → `My Icon`: a member's display name. */
const nameOf = (path: string): string => (path.split('/').at(-1) ?? path).replace(/\.svg$/i, '');

/** Every member witnessed through rotating sessions, the last disposed whatever happens; a session failure is the refusal. */
async function witnessed(
  files: Parameters<typeof importSvgBatch>[0] & { readonly kind: 'files' },
  ids: ReadonlyMap<string, string>,
  options: SvgLibraryOptions,
): Promise<Result<SvgBatchReport, readonly SvgMemberProblem[]>> {
  const sessions = await witnessSessions(options.startWitness, options.now);
  if (!sessions.ok) return rejected(sessions.error.map((d) => whole(d.message)));
  const faces = (options.fonts ?? []).map((f) => f.face);
  let report: SvgBatchReport;
  try {
    report = await importSvgBatch(files, {
      ids: Object.fromEntries(ids),
      witness: sessions.value.witness,
      ...(options.colors ? { colors: options.colors } : {}),
      ...(options.tokenRefs ? { tokenRefs: options.tokenRefs } : {}),
      ...(faces.length ? { fonts: faces, defaultFont: (faces[0] as SvgImportFont).sha256 } : {}),
    });
  } finally {
    await sessions.value.dispose();
  }
  // a session that could not start or close is the failure, not the members it left unwitnessed
  const failure = sessions.value.failure();
  return failure === undefined ? ok(report) : rejected(failure.map((d) => whole(d.message)));
}

/** Each member no credit names, and each credit member the input does not hold, by its own path. */
function uncovered(rights: ImportRights, ids: ReadonlyMap<string, string>): SvgMemberProblem[] {
  const { memberCredit } = rights;
  if (memberCredit === undefined) return [];
  return [
    ...[...ids.keys()].filter((path) => !memberCredit.has(path)).map((path) => ({ path, message: 'no credit names it' })),
    ...[...memberCredit].filter(([path]) => !ids.has(path)).map(([path, id]) => ({ path, message: `credit ${id} names it, but the input does not hold it` })),
  ];
}

type Prepared = {
  readonly files: SvgBatchFile[];
  readonly ids: Map<string, string>;
  readonly rights: ImportRights;
  readonly credits: ShapePackCredit[] | undefined;
};

/** The members, their ids, the rights and the scoped credits, or the refusals; nothing is witnessed yet. */
async function prepare(input: SvgLibraryInput, options: SvgLibraryOptions): Promise<Result<Prepared, readonly SvgMemberProblem[]>> {
  const read = await readLibraryMembers(input);
  if (!read.ok) return read;
  const files = read.value;
  const ids = memberIds(files, options.namespace);
  if (Array.isArray(ids)) return rejected(ids);
  const rights = rightsOf(options.rights);
  if (typeof rights === 'string') return rejected([whole(rights)]);
  // the content policy is checked before any witness starts, so a refused license costs no conversion
  const unpermitted = [rights.license, ...rights.credits.map((c) => c.license)].find((l) => !allowsShapePackContentLicense(l));
  if (unpermitted !== undefined) return rejected([whole(`the content license policy does not permit ${unpermitted}`)]);
  const coverage = uncovered(rights, ids);
  if (coverage.length) return rejected(coverage);
  const credits = scopedCredits(rights, ids);
  return typeof credits === 'string' ? rejected([whole(credits)]) : ok({ files, ids, rights, credits });
}

/** The accepted members as pack entries, each in its folder's category. */
const entriesOf = (report: Processed): ImportedPackEntry[] =>
  report.inputs.flatMap((r) =>
    r.status === 'accepted' ? [{ definition: { ...r.value.definition, category: categoryOf(r.path) }, name: nameOf(r.path), fonts: r.value.fonts }] : [],
  );

/**
 * Convert `input` under `options` into one checked pack, registering nothing; or every refusal, each naming its member path ('' for
 * the whole input). Bounds are checked before any bytes are read, and rights and the license policy before any witness starts.
 * @public
 */
export async function convertSvgLibrary(
  input: SvgLibraryInput,
  options: SvgLibraryOptions,
): Promise<Result<SvgLibraryConversion, readonly SvgMemberProblem[]>> {
  const prepared = await prepare(input, options);
  if (!prepared.ok) return prepared;
  const { files, ids, rights, credits } = prepared.value;
  const report = await witnessed({ kind: 'files', files }, ids, options);
  if (!report.ok) return report;
  const refusals = batchRefusals(report.value);
  if (refusals.length || report.value.status !== 'processed') return rejected(refusals.length ? refusals : [whole('nothing was converted')]);
  const entries = entriesOf(report.value);
  const [credit] = rights.credits;
  const pack = importedShapePack({
    namespace: options.namespace,
    version: options.version,
    name: options.name,
    license: rights.license,
    attribution: rights.attribution,
    notice: credit?.notice ?? '',
    source: credit?.source ?? { kind: 'original', author: rights.attribution, statement: '' },
    ...(credits === undefined ? {} : { credits }),
    entries,
    fonts: (options.fonts ?? []).map((f) => f.rights),
    licensePolicy: allowsShapePackContentLicense,
  });
  if (!pack.ok) return rejected(pack.error.map((d: Diagnostic) => whole(d.message)));
  return ok({ pack: pack.value, report: report.value, ...svgBatchColors(entries.map((e) => e.definition)) });
}
