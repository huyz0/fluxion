// SVG export (ADR-0056, FR-EXP-004): one screen as a standalone SVG 1.1 file. The screen is drawn by render's svg surface
// (`@fluxion/render/svg`, the same tree, order, masters and style resolution as present mode) through react-dom/server's
// renderToStaticMarkup; the ids React generates are renumbered `fx<n>-<k>` with every `url(#…)` and `#…` reference that names them;
// the package rides in `<metadata>` (svg-package.ts). Mixed runtime: no `node:*`, DOM or clock here; the host's measurer, registries
// and package writer come in as ports. Fonts (outlined or embedded subsets) are M20.13's: text is `<text>` naming its family.
import { appliedMaster, createCore, sha256Hex, type TextMeasurer } from '@fluxion/core';
import { writeFlux } from '@fluxion/format';
import { builtinRegistries, modePolicy, type RenderRegistries, screensInOrder } from '@fluxion/render';
import { ScreenSvgView, type SvgDiagnostic, SvgSurface } from '@fluxion/render/svg';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  /** The theme (default: the screen's, as the view picks it). */
  readonly theme?: Theme;
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

/** `<metadata>` of the export and the finding of a package left out. */
async function metadata(file: DocumentFile, screenId: RecordId, master: RecordId | undefined, write: SvgExportPorts['writePackage']) {
  const schema = String((file as { readonly schemaVersion?: unknown }).schemaVersion ?? '');
  const bytes = await (write ?? writeDefault)(screenPackage(file, screenId, master));
  if (bytes === undefined) {
    const diagnostic = { code: 'FLX_EXPORT_PACKAGE_OMITTED', message: 'the package could not be written and is left out' };
    return { xml: packageMetadata({ bytes, schema, screen: screenId, omitted: 'unwritable' }), diagnostic };
  }
  if (bytes.length > SVG_PACKAGE_MAX_BYTES) {
    const diagnostic = { code: 'FLX_EXPORT_PACKAGE_OMITTED', message: `the package is ${bytes.length} bytes, over ${SVG_PACKAGE_MAX_BYTES}: left out` };
    return { xml: packageMetadata({ bytes: undefined, schema, screen: screenId, omitted: 'too-large' }), diagnostic };
  }
  return { xml: packageMetadata({ bytes, schema, screen: screenId }), diagnostic: undefined };
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
  const view = createElement(ScreenSvgView, { store, screenId, mode: 'export', registries, ...(ports.theme === undefined ? {} : { theme: ports.theme }) });
  const surface = { report, ...(ports.measurer === undefined ? {} : { measurer: ports.measurer }) };
  const markup = namespaced(
    renumberIds(renderToStaticMarkup(createElement(SvgSurface.Provider, { value: surface }, view)), `fx${shown.indexOf(screenId) + 1}-`),
  );
  let svg = markup;
  if (options.package !== false) {
    const master = store.query((v) => appliedMaster(v, screenId).master)();
    const meta = await metadata(file, screenId, master, ports.writePackage);
    if (meta.diagnostic !== undefined) diagnostics.push(meta.diagnostic);
    svg = afterTitle(markup, meta.xml);
  }
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`, screenId, diagnostics };
}
