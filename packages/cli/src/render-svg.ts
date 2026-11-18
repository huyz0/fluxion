// `fluxion render <file> -o <dir> --format svg [--fonts outline|embed]` (FR-CLI-002, FR-EXP-004, ADR-0056): one standalone SVG
// per drawn screen, `<dir>/<screen-id>.svg`, by exporters' exportSvg with the measurer, registries and asset URLs the HTML page is
// drawn with. Text is outlined (the default) or embedded as used-glyph subsets from the faces the CLI knows: the document's own font
// assets first (a `.flux` carries their bytes), then the bundled fonts-core faces. The WOFF2 codec is format's pinned engine, read
// once; each subset runs in a fresh worker thread (the `convert --subset-fonts` job, ADR-0051). What the export could not draw as
// present mode draws it comes back as warnings pointing at the element or screen.
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSvg, type SvgFontFace, type SvgFontPorts } from '@fluxion/exporters';
import { fontAssetFace, instantiateFontEngines, type WasmInstantiate } from '@fluxion/format';
import { FONTS_CORE } from '@fluxion/pack-fonts-core';
import type { AssetUrls, RenderRegistries } from '@fluxion/render';
import { type AssetRecord, DIAGNOSTIC_CODES, type Diagnostic, type DiagnosticCode, type DocumentFile, jsonPointer, type RecordId } from '@fluxion/schema';
import { internal, io, type Outcome } from './command.js';
import { cliSubsetDeps } from './font-subset.js';
import type { measurerFor } from './measurer.js';
import { writeText } from './write-file.js';

/** How text is drawn in the SVG: outlined (the default) or embedded as subsets. */
export type SvgFonts = 'outline' | 'embed';

/** What the SVGs are drawn from: the document, the screens drawn, how the page was drawn, and the document's own font faces. */
export type SvgPage = {
  readonly document: DocumentFile;
  readonly drawn: readonly string[];
  readonly registries: RenderRegistries;
  readonly measurer: ReturnType<typeof measurerFor>;
  readonly assets?: AssetUrls;
  readonly faces: readonly SvgFontFace[];
};

/** The engine module `file` in the assets of the installed `@fluxion/format`. */
const engine = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(fileURLToPath(new URL(`../assets/font-engine/${file}`, import.meta.resolve('@fluxion/format')))));

/** Node's WebAssembly global; the CLI compiles without the DOM library that types it. */
type Wasm = { instantiate(bytes: Uint8Array, imports: unknown): Promise<{ readonly instance: { readonly exports: unknown } }> };
const instantiate: WasmInstantiate = async (bytes, imports) =>
  (await (globalThis as unknown as { readonly WebAssembly: Wasm }).WebAssembly.instantiate(bytes, imports)).instance as never;
const sha256 = (bytes: Uint8Array) => Promise.resolve(createHash('sha256').update(bytes).digest('hex'));

/** The bundled fonts-core faces with their bytes, verified (the pack ships them under their recorded OFL licence). */
async function bundledFaces(): Promise<SvgFontFace[]> {
  const base = new URL('../', import.meta.resolve('@fluxion/pack-fonts-core'));
  const faces = FONTS_CORE.flatMap((def) => (def.file === undefined ? [] : [def]));
  return Promise.all(
    faces.map(async (def) => ({
      family: def.family,
      weight: def.weight,
      style: def.style === 'italic' ? ('italic' as const) : ('normal' as const),
      bytes: new Uint8Array(await readFile(fileURLToPath(new URL(def.file as string, base)))),
      rights: [def.license, def.copyright].filter((s): s is string => typeof s === 'string').join('\n'),
      verifiedSource: true,
    })),
  );
}

/**
 * The document's own font faces: each font asset record naming a family, with its bytes from `bytesOf` (by hash), its recorded rights
 * and whether its source is verified (format's fontAssetFace, the rule `convert --subset-fonts` follows). An artwork alias is left out:
 * those faces belong to their pack's artwork, not to text.
 */
export function documentFaces(document: DocumentFile, bytesOf: (hash: string) => Uint8Array | undefined): SvgFontFace[] {
  return Object.values(document.records).flatMap((record): SvgFontFace[] => {
    if (record.type !== 'asset') return [];
    const asset = record as AssetRecord;
    const face = fontAssetFace(asset);
    const bytes = bytesOf(asset.hash);
    if (face.family === undefined || face.family.startsWith('fx-artwork-') || bytes === undefined || !asset.mime.startsWith('font/')) return [];
    const style = face.style === 'italic' ? ('italic' as const) : ('normal' as const);
    return [{ family: face.family, weight: face.weight, style, bytes, rights: face.rights, verifiedSource: face.verifiedSource }];
  });
}

/** The fonts an export borrows: `own` then the bundled faces, the codec instantiated once, and the CLI's font job. */
async function fontPorts(own: readonly SvgFontFace[]): Promise<SvgFontPorts> {
  let codec: ReturnType<SvgFontPorts['codec']> | undefined;
  const modules = async () => ({ harfbuzz: await engine('harfbuzz-subset.wasm'), codec: await engine('woff2-codec.wasm') });
  return {
    faces: [...own, ...(await bundledFaces())],
    codec: () => {
      codec ??= modules().then(async (m) => (await instantiateFontEngines(m, { sha256, instantiate })).codec);
      return codec;
    },
    subset: cliSubsetDeps({ sha256 }).job as NonNullable<SvgFontPorts['subset']>,
  };
}

/** An export finding as a CLI warning at the element (or the screen) it is about; a code the schema does not register is an internal error. */
function asDiagnostic(screenId: string, d: { readonly code: string; readonly message: string; readonly elementId?: string }): Diagnostic | string {
  if (!(d.code in DIAGNOSTIC_CODES)) return `the SVG export reported ${d.code}, which is not a registered diagnostic code`;
  const code = d.code as DiagnosticCode;
  return { code, severity: DIAGNOSTIC_CODES[code], path: jsonPointer(['records', d.elementId ?? screenId]), message: `screen ${screenId}: ${d.message}` };
}

/** Writes one SVG per drawn screen of `page` into `dir`: the files and what the exports reported, or the outcome that says why not. */
export async function renderSvgs(
  page: SvgPage,
  dir: string,
  fonts: SvgFonts,
): Promise<Outcome | { readonly files: readonly string[]; readonly diagnostics: readonly Diagnostic[] }> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    return io(`cannot write ${dir}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
  const ports = {
    registries: page.registries,
    measurer: page.measurer,
    fonts: await fontPorts(page.faces),
    ...(page.assets === undefined ? {} : { assets: page.assets }),
  };
  const files: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const screenId of page.drawn) {
    const { svg, diagnostics: found } = await exportSvg(page.document, { screenId: screenId as RecordId, fonts }, ports);
    for (const d of found) {
      const mapped = asDiagnostic(screenId, d);
      if (typeof mapped === 'string') return internal(mapped);
      diagnostics.push(mapped);
    }
    const file = join(dir, `${screenId}.svg`);
    const failed = await writeText(file, svg);
    if (failed !== undefined) return failed;
    files.push(file);
  }
  return { files, diagnostics };
}
