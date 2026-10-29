// `fluxion pack-import <folder | file.zip> -o <out-dir>` (FR-LIB-004, ADR-0206): a folder or ZIP of SVGs becomes one checked
// 1.0/1.1 pack directory, or nothing. Rights are declared per member; every member must be an SVG that converts under the shipped
// paint witness; the one artwork face is fonts-core's Inter 400 with its own rights; output is written atomically.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  type ImportedPack,
  type ImportedPackEntry,
  type ImportedPackFont,
  importedShapePack,
  importSvgBatch,
  type SvgBatchFile,
  type SvgBatchReport,
  sha256Hex,
} from '@fluxion/format';
import { FONTS_CORE } from '@fluxion/pack-fonts-core';
import type { Diagnostic } from '@fluxion/schema';
import { allowsShapePackContentLicense, LIGHT_THEME, type ShapePackCredit } from '@fluxion/sdk';
import { type Command, type Outcome, usage } from './command.js';
import { categoryOf, type InputProblem, memberIds, readMembers } from './pack-import-input.js';
import { fileRights, flagRights, type ImportRights, scopedCredits } from './pack-import-rights.js';
import { witnessSessions } from './pack-import-sessions.js';
import { writePackDir } from './pack-import-write.js';
import { createNodeSvgPaintWitness } from './svg-witness.js';
import type { NodeSvgWitnessOptions } from './svg-witness-types.js';

/** What the command needs from its host; tests replace the witness. */
export type PackImportPorts = {
  /** Starts the paint witness (the shipped Node bridge by default). */
  readonly witness: (options: NodeSvgWitnessOptions) => ReturnType<typeof createNodeSvgPaintWitness>;
};

const invalid = (path: string, message: string): Diagnostic => ({ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path, message });
const refused = (diagnostics: readonly Diagnostic[]): Outcome => ({ exitCode: 1, diagnostics });
const inputRefusal = (problems: readonly InputProblem[]): Outcome =>
  refused(problems.map((p) => invalid('/input', p.path === '' ? p.message : `${p.path} ${p.message}`)));

/** The one artwork face: fonts-core's Inter 400 normal, its bytes and its own declared rights (OFL-1.1). */
async function interFont(): Promise<{ face: { family: string; weight: number; style: 'normal'; sha256: string }; rights: ImportedPackFont }> {
  const def = FONTS_CORE.find((f) => f.family === 'Inter' && f.weight === 400 && f.style === 'normal');
  if (def === undefined || def.file === undefined) throw new Error('fonts-core has no Inter 400 normal');
  const base = new URL('../', import.meta.resolve('@fluxion/pack-fonts-core'));
  const bytes = new Uint8Array(await readFile(fileURLToPath(new URL(def.file as string, base))));
  const notice = await readFile(fileURLToPath(new URL('OFL.txt', base)), 'utf8');
  const sha256 = sha256Hex(bytes);
  const attribution = def.copyright ?? 'The Inter Project Authors';
  const source = { kind: 'upstream' as const, reference: `@fluxion/pack-fonts-core:${def.file}`, sha256 };
  return { face: { family: 'Inter', weight: 400, style: 'normal', sha256 }, rights: { bytes, license: def.license, attribution, notice, source } };
}

/** The batch report's refusals, each naming its member path; none when every member was accepted. */
function batchRefusals(report: SvgBatchReport): Diagnostic[] {
  if (report.status === 'preflight-failed') return report.diagnostics.map((d) => ({ ...d, path: '/input' }));
  return report.inputs.flatMap((r) => (r.status === 'refused' ? r.diagnostics.map((d) => ({ ...d, path: '/input', message: `${r.path}: ${d.message}` })) : []));
}

type Member = { readonly entry: ImportedPackEntry; readonly path: string; readonly sourceSha256: string };

/** `a/My Icon.svg` → `My Icon`: a member's display name. */
const nameOf = (path: string): string => (path.split('/').at(-1) ?? path).replace(/\.svg$/i, '');

/** The accepted members as pack entries, each with its path and source hash, its category from its folder. */
function acceptedMembers(report: SvgBatchReport): Member[] {
  if (report.status !== 'processed') return [];
  return report.inputs.flatMap((r) => {
    if (r.status !== 'accepted') return [];
    const entry = { definition: { ...r.value.definition, category: categoryOf(r.path) }, name: nameOf(r.path), fonts: r.value.fonts };
    return [{ entry, path: r.path, sourceSha256: r.sourceSha256 }];
  });
}

type Flags = { readonly input: string; readonly out: string; readonly namespace: string; readonly version: string; readonly name: string };

/** The flags of a pack-import, or the usage outcome. */
function flagsOf(values: Record<string, unknown>, positionals: readonly string[]): Flags | Outcome {
  const [input, ...extra] = positionals;
  if (input === undefined) return usage('pack-import needs a folder or a .zip file');
  if (extra.length > 0) return usage(`pack-import takes one input, got ${positionals.length}`);
  const text = (name: string) => (typeof values[name] === 'string' && values[name] !== '' ? (values[name] as string) : undefined);
  const [out, namespace, version, name] = ['out', 'namespace', 'version', 'name'].map(text);
  if (out === undefined) return usage('pack-import needs -o <out-dir>');
  if (namespace === undefined || version === undefined || name === undefined) return usage('pack-import needs --namespace, --version and --name');
  const { browser } = values;
  if (browser !== undefined && browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit')
    return usage('--browser is chromium, firefox or webkit');
  return { input, out, namespace, version, name };
}

/** Converts every member under successive witness sessions (128 requests each), the last disposed whatever happens. */
async function convert(files: readonly SvgBatchFile[], ids: ReadonlyMap<string, string>, browser: unknown, ports: PackImportPorts) {
  const inter = await interFont();
  const browserOption = typeof browser === 'string' ? { browser: browser as 'chromium' | 'firefox' | 'webkit' } : {};
  const sessions = await witnessSessions(() =>
    ports.witness({ theme: LIGHT_THEME, fonts: [{ ...inter.face, bytes: inter.rights.bytes, profile: 'inter-latin-400-ascii' }], ...browserOption }),
  );
  if ('kind' in sessions) return { failed: sessions.kind === 'peer-missing' ? 2 : 1, diagnostics: sessions.diagnostics } as const;
  let report: SvgBatchReport;
  try {
    report = await importSvgBatch(
      { kind: 'files', files },
      { ids: Object.fromEntries(ids), witness: sessions.witness, fonts: [inter.face], defaultFont: inter.face.sha256 },
    );
  } finally {
    await sessions.dispose();
  }
  // a session that could not start or close is the failure, not the members it left unwitnessed
  const failure = sessions.failure();
  if (failure !== undefined) return { failed: failure.kind === 'peer-missing' ? 2 : 1, diagnostics: failure.diagnostics } as const;
  return { report, inter } as const;
}

type Run = { readonly flags: Flags; readonly rights: ImportRights; readonly browser: unknown };
type Processed = Extract<SvgBatchReport, { readonly status: 'processed' }>;
type Prepared = { readonly files: SvgBatchFile[]; readonly ids: Map<string, string>; readonly credits: ShapePackCredit[] | undefined };

/** The members, their ids and their scoped credits, or the refusal; nothing is converted yet. */
async function prepare({ flags, rights }: Run): Promise<Prepared | Outcome> {
  if (existsSync(flags.out)) return refused([invalid('/argv', `${flags.out} exists; pack-import writes a new directory`)]);
  const files = await readMembers(flags.input);
  if (!Array.isArray(files)) return inputRefusal([files]);
  const ids = memberIds(files, flags.namespace);
  if (Array.isArray(ids)) return inputRefusal(ids);
  // the content policy is checked before any witness starts, so a refused license costs no conversion
  const unpermitted = [rights.license, ...rights.credits.map((c) => c.license)].find((l) => !allowsShapePackContentLicense(l));
  if (unpermitted !== undefined) return refused([invalid('/credits', `the content license policy does not permit ${unpermitted}`)]);
  const credits = scopedCredits(rights, ids);
  if (typeof credits === 'string') return refused([invalid('/credits', credits)]);
  return { files, ids, credits };
}

/** The reply of a written pack: what was read, and each definition with its member path, source hash, anchors and fonts. */
function resultOf(flags: Flags, report: Processed, accepted: readonly Member[], pack: ImportedPack) {
  return {
    pack: { id: flags.namespace, version: flags.version, formatVersion: pack.index.formatVersion, dir: flags.out },
    inputCount: report.inputCount,
    svgCount: report.svgCount,
    acceptedCount: report.acceptedCount,
    definitions: accepted.map(({ entry, path, sourceSha256 }) => ({
      id: entry.definition.id,
      name: entry.name,
      category: categoryOf(path),
      source: path,
      sourceSha256,
      anchors: entry.definition.anchors?.length ?? 0,
      fonts: (entry.fonts ?? []).map((f) => f.sha256),
    })),
    files: [...pack.files.keys()],
  };
}

/** Everything after the flags: read, check, convert, encode, write; nothing is written unless all of it succeeds. */
async function packImport(run: Run, ports: PackImportPorts, log: (text: string) => void): Promise<Outcome> {
  const { flags, rights } = run;
  const prepared = await prepare(run);
  if ('exitCode' in prepared) return prepared;
  const converted = await convert(prepared.files, prepared.ids, run.browser, ports);
  if ('failed' in converted) return { exitCode: converted.failed, diagnostics: converted.diagnostics ?? [] };
  const { report, inter } = converted;
  const problems = batchRefusals(report);
  if (problems.length || report.status !== 'processed') return refused(problems.length ? problems : [invalid('/input', 'nothing was converted')]);
  const accepted = acceptedMembers(report);
  const [credit] = rights.credits;
  const pack = importedShapePack({
    namespace: flags.namespace,
    version: flags.version,
    name: flags.name,
    license: rights.license,
    attribution: rights.attribution,
    notice: credit?.notice ?? '',
    source: credit?.source ?? { kind: 'original', author: rights.attribution, statement: '' },
    ...(prepared.credits === undefined ? {} : { credits: prepared.credits }),
    entries: accepted.map((m) => m.entry),
    fonts: [inter.rights],
    licensePolicy: allowsShapePackContentLicense,
  });
  if (!pack.ok) return refused(pack.error);
  const failed = await writePackDir(flags.out, pack.value.files);
  if (failed !== undefined) return refused([{ code: 'FLX_CLI_IO', severity: 'error', path: '/argv', message: failed }]);
  log(`${flags.input} -> ${flags.out} (${accepted.length} shapes)\n`);
  return { exitCode: 0, diagnostics: [], result: resultOf(flags, report, accepted, pack.value) };
}

const browserOf = ({ browser }: Record<string, unknown>): unknown => browser;

/** The declared rights: a `--credits` file or the rights flags, never both; the usage or refusal outcome otherwise. */
async function rightsOf(values: Record<string, unknown>): Promise<ImportRights | Outcome> {
  const { credits } = values;
  if (typeof credits !== 'string') {
    const rights = await flagRights(values);
    return typeof rights === 'string' ? usage(rights) : rights;
  }
  if (['license', 'attribution', 'author', 'upstream', 'upstream-sha256', 'notice-file'].some((k) => values[k] !== undefined))
    return usage('give --credits or the rights flags, not both');
  const rights = await fileRights(credits);
  return typeof rights === 'string' ? refused([invalid('/credits', rights)]) : rights;
}

/** The command with its host ports (tests inject a witness). */
export function packImportCommand(ports: PackImportPorts): Command {
  return {
    summary: 'Turn a folder or ZIP of SVGs into a checked shape pack directory',
    usage:
      'pack-import <folder | file.zip> -o <out-dir> --namespace <ns> --version <semver> --name <text> (--credits <file.json> | --license <spdx> --attribution <text> (--author <text> | --upstream <ref> --upstream-sha256 <hex>) [--notice-file <path>]) [--browser chromium|firefox|webkit]',
    options: {
      out: { type: 'string', short: 'o' },
      namespace: { type: 'string' },
      version: { type: 'string' },
      name: { type: 'string' },
      credits: { type: 'string' },
      license: { type: 'string' },
      attribution: { type: 'string' },
      author: { type: 'string' },
      upstream: { type: 'string' },
      'upstream-sha256': { type: 'string' },
      'notice-file': { type: 'string' },
      browser: { type: 'string' },
    },
    run: async ({ values, positionals }, io) => {
      const flags = flagsOf(values, positionals);
      if ('exitCode' in flags) return flags;
      const rights = await rightsOf(values);
      if ('exitCode' in rights) return rights;
      return packImport({ flags, rights, browser: browserOf(values) }, ports, io.stderr);
    },
  };
}

/** `pack-import`, with the shipped Node paint witness. */
export const PACK_IMPORT: Command = packImportCommand({ witness: createNodeSvgPaintWitness });
