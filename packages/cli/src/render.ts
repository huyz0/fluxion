// `fluxion render <file> -o <out.html> [--screen <id>…]` (FR-CLI-001, FR-SCR-001, ADR-0015): the
// document as one static HTML page, written by render's renderDocumentToHtml. An invalid document
// exits 1 with its diagnostics (as validate reports them); an unknown screen id is a usage error.
import { writeFile } from 'node:fs/promises';
import { builtinRegistries } from '@fluxion/render';
import { renderDocumentToHtml } from '@fluxion/render/ssr';
import { globalRoutes } from '@fluxion/routing';
import { type Diagnostic, type DocumentFile, parseDocument, type RecordId } from '@fluxion/schema';
import { type Command, internal, io, type Outcome, unsupported, usage } from './command.js';
import { hostRegistries } from './host.js';
import { measurerFor } from './measurer.js';
import { type Launcher, playwrightLauncher, renderPngs } from './render-png.js';
import { readInput } from './validate.js';

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
  { html, drawn, out, format, launch }: { html: string; drawn: readonly string[]; out: string; format: 'html' | 'png'; launch: Launcher },
  log: (text: string) => void,
): Promise<Outcome | { out: string; screens: number; files?: readonly string[] }> {
  if (format === 'png') {
    const files = await renderPngs(html, drawn, out, launch);
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

/** The static page of the document in `text`: its HTML, the screens drawn and the document; or the outcome that says why not. */
export function staticPage(
  text: string,
  screens: readonly string[] | undefined,
  label: string,
): Outcome | { html: string; drawn: readonly string[]; document: DocumentFile; diagnostics: readonly Diagnostic[] } {
  // the bundled packs are the CLI's own: one failing to register is an internal error (ADR-0017)
  const host = hostRegistries();
  if (host.problems.length > 0) return internal(host.problems.map((d) => d.message).join('; '));
  const parsed = parseDocument(text);
  if (!parsed.ok) return { exitCode: 1, diagnostics: parsed.error.diagnostics };
  const problem = screenProblem(parsed.value.document, screens ?? [], label);
  if (problem !== undefined) return usage(problem);
  // shapes and markers come from the bundled packs, registered in the host's core registries (ADR-0017); the connectors draw the global
  // routing pass's routes, as the studio and the .flux.html do (M16.28)
  const registries = { ...builtinRegistries(host.registries.shapeDefs, undefined, host.registries.markers), globalPass: () => globalRoutes };
  const { html, screens: drawn } = renderDocumentToHtml(parsed.value.document, {
    registries,
    measurer: measurerFor(parsed.value.document),
    ...(screens === undefined ? {} : { screens: screens as readonly RecordId[] }),
  });
  return { html, drawn, document: parsed.value.document, diagnostics: parsed.value.diagnostics };
}

/** Renders the document at `file` to `out`. */
async function render({ file, out, format, screens, launch }: Request, log: (text: string) => void): Promise<Outcome> {
  // checked before the input is read: a broken bundle is not the user's file
  const host = hostRegistries();
  if (host.problems.length > 0) return internal(host.problems.map((d) => d.message).join('; '));
  const text = await readInput(file);
  if (typeof text !== 'string') return text;
  const page = staticPage(text, screens, file);
  if ('exitCode' in page) return page;
  const written = await emit({ html: page.html, drawn: page.drawn, out, format, launch }, log);
  return 'exitCode' in written ? written : { exitCode: 0, diagnostics: page.diagnostics, result: written };
}

/** The `render` command. */
export const RENDER: Command = {
  summary: 'Render a document to a static HTML file, or a PNG per screen',
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
