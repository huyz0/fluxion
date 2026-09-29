// `fluxion render <file> -o <out.html> [--screen <id>…]` (FR-CLI-001, FR-SCR-001, ADR-0015): the
// document as one static HTML page, written by render's renderDocumentToHtml. An invalid document
// exits 1 with its diagnostics (as validate reports them); an unknown screen id is a usage error.
import { writeFile } from 'node:fs/promises';
import { renderDocumentToHtml } from '@fluxion/render';
import { type DocumentFile, parseDocument, type RecordId } from '@fluxion/schema';
import { type Command, io, type Outcome, usage } from './command.js';
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

/** Renders the document at `file` to `out`. */
async function render(file: string, out: string, screens: readonly string[] | undefined, log: (text: string) => void): Promise<Outcome> {
  const text = await readInput(file);
  if (typeof text !== 'string') return text;
  const parsed = parseDocument(text);
  if (!parsed.ok) return { exitCode: 1, diagnostics: parsed.error.diagnostics };
  const problem = screenProblem(parsed.value.document, screens ?? [], file);
  if (problem !== undefined) return usage(problem);
  const { html, screens: drawn } = renderDocumentToHtml(parsed.value.document, screens === undefined ? {} : { screens: screens as readonly RecordId[] });
  try {
    await writeFile(out, html, 'utf8');
  } catch (e) {
    return io(`cannot write ${out}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
  // the renderer says what it drew; the markup is not parsed for it (M4 final F2)
  const count = drawn.length;
  log(`${out}: ${count} screen${count === 1 ? '' : 's'}\n`);
  return { exitCode: 0, diagnostics: parsed.value.diagnostics, result: { out, screens: count } };
}

/** The `render` command. */
export const RENDER: Command = {
  summary: 'Render a document to a static HTML file',
  usage: 'render <file> -o <out.html> [--screen <id>]',
  options: { out: { type: 'string', short: 'o' }, screen: { type: 'string', multiple: true } },
  run: ({ values, positionals }, out) => {
    const [file, ...extra] = positionals;
    if (file === undefined) return usage('render needs a document file');
    if (extra.length > 0) return usage(`render takes one file, got ${positionals.length}`);
    const target = values['out'];
    if (typeof target !== 'string' || target === '') return usage('render needs -o <out.html>');
    const screens = values['screen'] as string[] | undefined;
    return render(file, target, screens, out.stderr);
  },
};
