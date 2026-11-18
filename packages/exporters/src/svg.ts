// SVG export (ADR-0056, FR-EXP-004): one screen as a standalone SVG 1.1 file. The screen is drawn by render's svg surface
// (`@fluxion/render/svg`, the same tree, order, masters and style resolution as present mode) through react-dom/server's
// renderToStaticMarkup; the ids React generates are renumbered `fx<n>-<k>` with every `url(#…)` and `#…` reference that names them;
// the package rides in `<metadata>` (svg-package.ts). Mixed runtime: no `node:*`, DOM or clock here; the host's measurer, registries
// and package writer come in as ports. Fonts (outlined or embedded subsets) are M20.13's: text is `<text>` naming its family.
import { appliedMaster, type Core, createCore, sha256Hex, type TextMeasurer } from '@fluxion/core';
import { writeFlux } from '@fluxion/format';
import { builtinRegistries, modePolicy, type RenderRegistries, screensInOrder } from '@fluxion/render';
import { ScreenSvgView, type SvgDiagnostic, SvgSurface, type SvgSurfaceContext, selectionScope } from '@fluxion/render/svg';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { embedRuns } from './svg-embed.js';
import { glyphCollector, outlineRuns, type SvgFontPorts } from './svg-fonts.js';
import { PACKAGE_NS, packageMetadata, SVG_PACKAGE_MAX_BYTES, screenPackage } from './svg-package.js';
import { VERSION } from './version.js';

/**
 * What to export.
 *
 * @public
 */
export type SvgExportOptions = {
  /** The screen (default: the first screen the export mode shows). */
  readonly screenId?: RecordId;
  /** Carry the package in `<metadata>` (default true). */
  readonly package?: boolean;
  /**
   * Export these elements of the screen instead of all of it (ADR-0056 item 6): their members, connectors whose two ends are drawn,
   * no master, a viewBox of their outset bounds; the package is pruned to them (`scope="selection"`).
   */
  readonly selection?: readonly RecordId[];
  /**
   * How text is drawn (ADR-0056 item 5): `outline` (default), each piece as its glyphs' path from its face; `embed`, as `<text>`
   * naming its face's subset, embedded once in `<defs><style>` as an `@font-face`.
   */
  readonly fonts?: 'outline' | 'embed';
};

/**
 * What the host lends an export.
 *
 * @public
 */
export type SvgExportPorts = {
  /** Measures text: the studio's metrics measurer, the CLI's `measurerFor(document)` (default: the fixed advance). */
  readonly measurer?: TextMeasurer;
  /** Where element views and shape definitions are looked up (default: the built-ins over the document core's registries). */
  readonly registries?: RenderRegistries;
  /** Asset bytes as `data:` URLs by asset id, for images, image fills and component snapshots (default: none, each reported). */
  readonly assets?: (assetId: RecordId) => string | undefined;
  /** The theme (default: the screen's, as the view picks it). */
  readonly theme?: Theme;
  /**
   * The faces text is outlined with and the WOFF2 codec that reads them (ADR-0056 item 5: fonts are outlined by default); a font no
   * face matches stays `<text>` naming its family, reported `FLX_EXPORT_FONT_NOT_EMBEDDED` (default: no faces).
   */
  readonly fonts?: SvgFontPorts;
  /** Writes the package `.flux` of the pruned document (default: format's writeFlux with no asset bytes); undefined leaves it out. */
  readonly writePackage?: (document: DocumentFile) => Promise<Uint8Array | undefined>;
};

/**
 * An exported screen.
 *
 * @public
 */
export type SvgExport = {
  /** The file's text: an XML declaration and one root `<svg version="1.1">`. */
  readonly svg: string;
  /** The screen drawn. */
  readonly screenId: RecordId;
  /** What could not be drawn as present mode draws it, and a package left out. */
  readonly diagnostics: readonly SvgDiagnostic[];
};

/**
 * `markup`'s ids renumbered `<prefix><k>` in order of appearance, with every reference to them (`url(#…)`, `href="#…"`).
 *
 * @public
 */
export function renumberIds(markup: string, prefix: string): string {
  const ids = new Map<string, string>();
  for (const m of markup.matchAll(/\sid="([^"]+)"/g)) {
    const id = m[1] as string;
    if (!ids.has(id)) ids.set(id, `${prefix}${ids.size + 1}`);
  }
  const swap = (id: string) => ids.get(id) ?? id;
  return markup
    .replace(/(\sid=")([^"]+)(")/g, (_, a: string, id: string, b: string) => `${a}${swap(id)}${b}`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${swap(id)})`)
    .replace(/(href=")#([^"]+)(")/g, (_, a: string, id: string, b: string) => `${a}#${swap(id)}${b}`);
}

/** The view's data attributes, which SVG 1.1 does not have, in the export's own namespace (allowed by SVG 1.1's extensibility). */
const FOREIGN: ReadonlyArray<readonly [string, string]> = [
  [' data-el-id="', ' fluxion:el="'],
  [' data-master-id="', ' fluxion:master="'],
  [' data-screen-id="', ' fluxion:screen="'],
];

/** `markup` with the view's data attributes in the fluxion namespace, declared on the root. */
function namespaced(markup: string): string {
  const out = FOREIGN.reduce((m, [from, to]) => m.split(from).join(to), markup);
  return out.replace(/^<svg /, `<svg xmlns:fluxion="${PACKAGE_NS}" `);
}

/** The package bytes of `document` written by format's writer, or undefined when it refuses (no asset bytes at hand). */
async function writeDefault(document: DocumentFile): Promise<Uint8Array | undefined> {
  const written = await writeFlux({ document, appVersion: VERSION, hasher: { sha256: (bytes) => Promise.resolve(sha256Hex(bytes)) } });
  return written.ok ? written.value : undefined;
}

/** What the package holds: the screen, its applied master, and the drawn elements of a selection export. */
type PackageScope = { readonly screenId: RecordId; readonly master: RecordId | undefined; readonly only: ReadonlySet<RecordId> | undefined };

/** The package scope of screen `screenId`: its applied master, and the drawn elements when `selection` is given. */
function packageScope(store: Core['store'], screenId: RecordId, selection: readonly RecordId[] | undefined): PackageScope {
  const master = store.query((v) => appliedMaster(v, screenId).master)();
  const only = selection === undefined ? undefined : store.query((v) => selectionScope(v, screenId, selection).drawn)();
  return { screenId, master, only };
}

/** `<metadata>` of the export and the finding of a package left out. */
async function metadata(file: DocumentFile, at: PackageScope, write: SvgExportPorts['writePackage']) {
  const schema = String((file as { readonly schemaVersion?: unknown }).schemaVersion ?? '');
  const head = { schema, screen: at.screenId, scope: at.only === undefined ? ('screen' as const) : ('selection' as const) };
  const bytes = await (write ?? writeDefault)(screenPackage(file, at.screenId, at.master, at.only));
  if (bytes === undefined) {
    const diagnostic = { code: 'FLX_EXPORT_PACKAGE_OMITTED', message: 'the package could not be written and is left out' };
    return { xml: packageMetadata({ ...head, bytes, omitted: 'unwritable' }), diagnostic };
  }
  if (bytes.length > SVG_PACKAGE_MAX_BYTES) {
    const diagnostic = { code: 'FLX_EXPORT_PACKAGE_OMITTED', message: `the package is ${bytes.length} bytes, over ${SVG_PACKAGE_MAX_BYTES}: left out` };
    return { xml: packageMetadata({ ...head, bytes: undefined, omitted: 'too-large' }), diagnostic };
  }
  return { xml: packageMetadata({ ...head, bytes }), diagnostic: undefined };
}

/** No faces: every font stays `<text>`, reported; the codec is never asked for. */
const NO_FONTS: SvgFontPorts = { faces: [], codec: () => Promise.reject(new Error('no font faces were lent')) };

/**
 * The markup of `view` in three phases (ADR-0056 item 2): a render that records each piece's text in its font, the outlines of those
 * runs, and the render that draws them. Both renders read the same store and measurer, so they lay out the same lines.
 */
async function drawn(
  view: ReactElement,
  surface: SvgSurfaceContext,
  fonts: { readonly mode: 'outline' | 'embed' | undefined; readonly ports: SvgFontPorts | undefined },
): Promise<string> {
  const render = (extra: Partial<SvgSurfaceContext>) => renderToStaticMarkup(createElement(SvgSurface.Provider, { value: { ...surface, ...extra } }, view));
  const { runs, glyphs } = glyphCollector();
  render({ glyphs });
  const report = surface.report ?? (() => undefined);
  if (fonts.mode !== 'embed') return render({ outline: await outlineRuns(runs, fonts.ports ?? NO_FONTS, report) });
  const { css, family } = await embedRuns(runs, fonts.ports ?? NO_FONTS, report);
  const markup = render({ family });
  return css === '' ? markup : afterTitle(markup, `<defs><style type="text/css">${css}</style></defs>`);
}

/** `markup` with `inserted` after its `<title>` and `<desc>` (the first children, for readers). */
function afterTitle(markup: string, inserted: string): string {
  const title = markup.indexOf('</title>');
  if (title < 0) return markup.replace(/^(<svg[^>]*>)/, `$1${inserted}`);
  let at = title + '</title>'.length;
  if (markup.startsWith('<desc>', at)) at = markup.indexOf('</desc>', at) + '</desc>'.length;
  return markup.slice(0, at) + inserted + markup.slice(at);
}

/**
 * Screen `options.screenId` of `file` (default: the first shown) as a standalone SVG 1.1 file: no `foreignObject`, script or
 * external reference; colours as literals; text as measured `<tspan>`s; the package in `<metadata>` unless `options.package` is
 * false. Deterministic: the same input gives the same text in every host.
 *
 * @example
 * ```ts
 * const { svg, diagnostics } = await exportSvg(file, { screenId }, { measurer, registries });
 * ```
 * @public
 */
export async function exportSvg(file: DocumentFile, options: SvgExportOptions = {}, ports: SvgExportPorts = {}): Promise<SvgExport> {
  const core = createCore(file);
  const { store } = core;
  const shown = store.query((view) => screensInOrder(view, modePolicy('export').showHidden))();
  const screenId = options.screenId ?? shown[0];
  if (screenId === undefined || store.get(screenId)?.type !== 'screen') {
    return { svg: '', screenId: (screenId ?? '') as RecordId, diagnostics: [{ code: 'FLX_EXPORT_NO_SCREEN', message: 'the document has no such screen' }] };
  }
  const registries = ports.registries ?? builtinRegistries(core.registries.shapeDefs);
  const diagnostics: SvgDiagnostic[] = [];
  const seen = new Set<string>();
  const report = (d: SvgDiagnostic) => {
    const key = `${d.code}\u0000${d.elementId ?? ''}\u0000${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(d);
  };
  const view = createElement(ScreenSvgView, {
    store,
    screenId,
    mode: 'export',
    registries,
    ...(ports.theme === undefined ? {} : { theme: ports.theme }),
    ...(options.selection === undefined ? {} : { selection: options.selection }),
  });
  const surface = {
    report,
    ...(ports.measurer === undefined ? {} : { measurer: ports.measurer }),
    ...(ports.assets === undefined ? {} : { assets: ports.assets }),
  };
  const markup = namespaced(renumberIds(await drawn(view, surface, { mode: options.fonts, ports: ports.fonts }), `fx${shown.indexOf(screenId) + 1}-`));
  let svg = markup;
  if (options.package !== false) {
    const meta = await metadata(file, packageScope(store, screenId, options.selection), ports.writePackage);
    if (meta.diagnostic !== undefined) diagnostics.push(meta.diagnostic);
    svg = afterTitle(markup, meta.xml);
  }
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`, screenId, diagnostics };
}
