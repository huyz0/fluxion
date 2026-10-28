// `fluxion render <file> -o <out.html> [--screen <id>…]` (FR-CLI-001, FR-SCR-001, ADR-0015): the
// document as one static HTML page, written by render's renderDocumentToHtml. An invalid document
// exits 1 with its diagnostics (as validate reports them); an unknown screen id is a usage error.
// A `.flux` archive is opened by the loader under the shape content policy; its saved packs' exact
// artwork fonts are embedded under their private aliases, and missing bytes refuse it (ADR-0192).
import { readFile, writeFile } from 'node:fs/promises';
import { loadFlux, sha256Hex } from '@fluxion/format';
import { type AssetUrls, builtinRegistries } from '@fluxion/render';
import { type EmbeddedShapePacks, embedSavedShapePacks, renderDocumentToHtml } from '@fluxion/render/ssr';
import { globalRoutes } from '@fluxion/routing';
import { type Diagnostic, type DocumentFile, jsonPointer, parseDocument, type RecordId } from '@fluxion/schema';
import { allowsShapePackContentLicense } from '@fluxion/sdk';
import { type Command, internal, io, type Outcome, unsupported, usage } from './command.js';
import { hostRegistries } from './host.js';
import { measurerFor } from './measurer.js';
import { type Launcher, playwrightLauncher, renderPngs } from './render-png.js';

/**
 * Why the screens `wanted` names cannot be rendered: not screens of `document`, or hidden (export
 * skips hidden screens, so asking for one would write an empty page; M4.20 review F2).
 */
function screenProblem(document: DocumentFile, wanted: readonly string[], file: string): string | undefined {
  const missing = wanted.filter((id) => document.records[id]?.type !== 'screen');
  if (missing.length > 0) return `no screen ${missing.map((id) => `"${id}"`).join(', ')} in ${file}`;
  const hidden = wanted.filter((id) => (document.records[id] as { readonly hidden?: unknown }).hidden === true);
  if (hidden.length > 0) return `screen ${hidden.map((id) => `"${id}"`).join(', ')} is hidden; show it to render it`;
  return undefined;
}

/** What `render` was asked for. */
type Request = {
  readonly file: string;
  /** The HTML file, or for png the directory of the images. */
  readonly out: string;
  readonly format: 'html' | 'png';
  readonly screens: readonly string[] | undefined;
  readonly launch: Launcher;
};

/** What the page is written as: the files or the one HTML file, and the reply's result; or the outcome that says why not. */
async function emit(
  { html, drawn, fonts, out, format, launch }: Page & { out: string; format: 'html' | 'png'; launch: Launcher },
  log: (text: string) => void,
): Promise<Outcome | { out: string; screens: number; files?: readonly string[] }> {
  if (format === 'png') {
    const files = await renderPngs({ html, fonts }, drawn, out, launch);
    if (!Array.isArray(files)) return files as Outcome;
    log(`${out}: ${files.length} PNG${files.length === 1 ? '' : 's'}\n`);
    return { out, screens: files.length, files };
  }
  try {
    await writeFile(out, html, 'utf8');
  } catch (e) {
    return io(`cannot write ${out}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
  // the renderer says what it drew; the markup is not parsed for it (M4 final F2)
  log(`${out}: ${drawn.length} screen${drawn.length === 1 ? '' : 's'}\n`);
  return { out, screens: drawn.length };
}

/** A rendered page: its HTML, the screens drawn, the private families of the artwork fonts it embeds, the document and what it reported. */
type Page = { html: string; drawn: readonly string[]; fonts: readonly string[]; document: DocumentFile; diagnostics: readonly Diagnostic[] };

/** The page of `document` drawn from `host` (and the saved packs' `embedded` fonts); or the usage outcome for a screen it lacks. */
function pageOf(
  document: DocumentFile,
  host: ReturnType<typeof hostRegistries>['registries'],
  options: {
    screens: readonly string[] | undefined;
    label: string;
    diagnostics: readonly Diagnostic[];
    embedded?: EmbeddedShapePacks;
    assets?: AssetUrls;
  },
): Outcome | Page {
  const problem = screenProblem(document, options.screens ?? [], options.label);
  if (problem !== undefined) return usage(problem);
  const fonts = options.embedded?.fonts ?? [];
  // shapes and markers come from the bundled packs, registered in the host's core registries (ADR-0017); the connectors draw the global
  // routing pass's routes, as the studio and the .flux.html do (M16.28)
  const registries = { ...builtinRegistries(host.shapeDefs, undefined, host.markers, options.embedded?.artworkFonts), globalPass: () => globalRoutes };
  const { html, screens: drawn } = renderDocumentToHtml(document, {
    registries,
    measurer: measurerFor(document),
    ...(options.screens === undefined ? {} : { screens: options.screens as readonly RecordId[] }),
    ...(fonts.length ? { artworkFonts: fonts } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
  });
  return { html, drawn, fonts: fonts.map((f) => f.alias), document, diagnostics: options.diagnostics };
}

/** The static page of the document in `text`: its HTML, the screens drawn and the document; or the outcome that says why not. */
export function staticPage(text: string, screens: readonly string[] | undefined, label: string): Outcome | Page {
  // the bundled packs are the CLI's own: one failing to register is an internal error (ADR-0017)
  const host = hostRegistries();
  if (host.problems.length > 0) return internal(host.problems.map((d) => d.message).join('; '));
  const parsed = parseDocument(text);
  if (!parsed.ok) return { exitCode: 1, diagnostics: parsed.error.diagnostics };
  return pageOf(parsed.value.document, host.registries, { screens, label, diagnostics: parsed.value.diagnostics });
}

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes)) };
/** The static page of the `.flux` archive `bytes`, its saved packs registered with their exact artwork fonts; or why not. */
export async function archivePage(bytes: Uint8Array, screens: readonly string[] | undefined, label: string): Promise<Outcome | Page> {
  const host = hostRegistries();
  if (host.problems.length > 0) return internal(host.problems.map((d) => d.message).join('; '));
  const loaded = await loadFlux(bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense });
  if (!loaded.ok) return io(`cannot render ${label}: ${loaded.error.message}`, ['argv']);
  const { shapePacks, assets } = loaded.value;
  const packs = await embedSavedShapePacks(host.registries.shapeDefs, shapePacks, {
    bytesOf: (sha) => assets.get(sha)?.bytes,
    policy: allowsShapePackContentLicense,
    sha256: hasher.sha256,
  });
  if (!packs.ok) return { exitCode: 1, diagnostics: packs.error };
  // what the loader found damaged in the container is reported with the page; a file opened only in part is not rendered as if whole
  const { document, diagnostics, notes, salvage } = loaded.value;
  if (salvage !== undefined) return io(`cannot render ${label}: it opens only in part (${salvage.reason}); open and save it whole first`, ['argv']);
  const noted = notes.map(
    (n): Diagnostic => ({ code: 'FLX_CLI_IO', severity: 'warning', path: jsonPointer(['entries', n.entry]), message: `${label}: ${n.message}` }),
  );
  return pageOf(document, host.registries, { screens, label, diagnostics: [...diagnostics, ...noted], embedded: packs.value, assets: assetUrls(loaded.value) });
}

/** The archive's images as `data:` URLs by asset record id, from the loader's verified bytes. */
function assetUrls(loaded: {
  readonly document: DocumentFile;
  readonly assets: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly mime: string }>;
}): AssetUrls {
  const urls = new Map<string, string>();
  for (const record of Object.values(loaded.document.records) as { id: string; type: string; hash?: unknown }[]) {
    const asset = record.type === 'asset' && typeof record.hash === 'string' ? loaded.assets.get(record.hash) : undefined;
    // only images: the static page draws nothing else from an asset
    if (asset !== undefined && /^image\/[a-z0-9.+-]+$/.test(asset.mime))
      urls.set(record.id, `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`);
  }
  return (id) => urls.get(id);
}

/** The bytes of `file`; or the outcome that says why it cannot be read. */
async function readBytes(file: string): Promise<Uint8Array | Outcome> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (e) {
    return io(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
}

/** Whether `bytes` start as a zip archive does (a `.flux`). */
const isArchive = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** Renders the document at `file` to `out`. */
async function render({ file, out, format, screens, launch }: Request, log: (text: string) => void): Promise<Outcome> {
  // checked before the input is read: a broken bundle is not the user's file
  const host = hostRegistries();
  if (host.problems.length > 0) return internal(host.problems.map((d) => d.message).join('; '));
  const bytes = await readBytes(file);
  if (!(bytes instanceof Uint8Array)) return bytes;
  const page = isArchive(bytes) ? await archivePage(bytes, screens, file) : staticPage(new TextDecoder().decode(bytes), screens, file);
  if ('exitCode' in page) return page;
  const written = await emit({ ...page, out, format, launch }, log);
  return 'exitCode' in written ? written : { exitCode: 0, diagnostics: page.diagnostics, result: written };
}

/** The `render` command. */
export const RENDER: Command = {
  summary: 'Render a document or a .flux file to a static HTML file, or a PNG per screen',
  usage: 'render <file> -o <out.html | out-dir> [--format html|png] [--screen <id>]',
  options: { out: { type: 'string', short: 'o' }, format: { type: 'string' }, screen: { type: 'string', multiple: true } },
  run: ({ values, positionals }, out) => {
    const [file, ...extra] = positionals;
    if (file === undefined) return usage('render needs a document file');
    if (extra.length > 0) return usage(`render takes one file, got ${positionals.length}`);
    const target = values['out'];
    if (typeof target !== 'string' || target === '') return usage('render needs -o <out.html>');
    const format = values['format'] ?? 'html';
    if (format !== 'html' && format !== 'png') return unsupported(`render writes html or png, not "${String(format)}"`, ['argv']);
    const screens = values['screen'] as string[] | undefined;
    return render({ file, out: target, format, screens, launch: playwrightLauncher }, out.stderr);
  },
};
