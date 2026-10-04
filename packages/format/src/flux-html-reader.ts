// The `.flux.html` reader (FR-FIL-002, FR-FIL-003; architecture/08 §3): finds the archive in the text of a `.flux.html` by scanning, never by running
// or parsing it as a page, so a file from anywhere can be read without executing a byte of it. Both markers must sit in the first 4 kB, the data block
// is the first `<script>` whose id is `fluxion-package`, and the bytes it decodes to are what `loadFlux` then opens (so a hostile file gets no further
// than the loader's limits). The scan is linear: every step is an `indexOf`.
import { err, ok, type Result } from '@fluxion/schema';
import { decodeBase64 } from './base64.js';
import type { FormatError } from './errors.js';
import { FLUX_HTML_MARKER_COMMENT, FLUX_HTML_MARKER_META } from './flux-html.js';
import type { ContentHasher } from './flux-writer.js';

/** The marker window: the markers are found in the first this many characters (the writer keeps them in the first 4 kB). */
const MARKER_WINDOW = 4096;
/** The most base64 text read: a 256 MiB archive is 4/3 of that (the loader's own total limit). */
const MAX_PAYLOAD_CHARS = Math.ceil((256 * 1024 * 1024 * 4) / 3) + 1024;

const notFlux = (message: string): Result<never, FormatError> => err({ code: 'FILE_NOT_FLUX', message });

/** The value of the double-quoted attribute `name` in the start tag `tag` (text between `<script` and `>`), or undefined. */
function attribute(tag: string, name: string): string | undefined {
  const needle = ` ${name}="`;
  const at = tag.indexOf(needle);
  if (at < 0) return undefined;
  const start = at + needle.length;
  const end = tag.indexOf('"', start);
  return end < 0 ? undefined : tag.slice(start, end);
}

/** The start tag and body of the first `<script>` element with id `fluxion-package`, or undefined. */
function dataBlock(html: string): { readonly tag: string; readonly body: string } | undefined {
  let from = 0;
  for (;;) {
    const open = html.indexOf('<script', from);
    if (open < 0) return undefined;
    const tagEnd = html.indexOf('>', open);
    if (tagEnd < 0) return undefined;
    const tag = html.slice(open + '<script'.length, tagEnd);
    const close = html.indexOf('</script>', tagEnd);
    if (close < 0) return undefined;
    // the first script with the id is the data block: a later one with the same id is not read
    if (attribute(tag, 'id') === 'fluxion-package') return { tag, body: html.slice(tagEnd + 1, close) };
    from = close + '</script>'.length;
  }
}

/**
 * The `.flux` archive inside the `.flux.html` `html`, byte for byte as it was embedded. A file without both markers in its first 4 kB, without a data
 * block, or with a payload that is not base64 is `FILE_NOT_FLUX`; one whose archive does not match its `data-sha256` is `FILE_ZIP_INVALID`. The
 * archive is not opened here: pass it to `loadFlux`.
 *
 * @public
 */
export async function readFluxHtml(html: string, hasher: ContentHasher): Promise<Result<Uint8Array, FormatError>> {
  const head = html.slice(0, MARKER_WINDOW);
  if (!head.includes(FLUX_HTML_MARKER_META) || !head.includes(FLUX_HTML_MARKER_COMMENT)) {
    return notFlux('the file does not carry the fluxion markers in its first 4 kB');
  }
  const block = dataBlock(html);
  if (block === undefined) return notFlux('the file has no fluxion data block');
  if (attribute(block.tag, 'data-encoding') !== 'base64') return notFlux('the data block is not base64');
  if (block.body.length > MAX_PAYLOAD_CHARS) return err({ code: 'FILE_TOO_LARGE', message: 'the data block is larger than the loader reads' });
  const bytes = decodeBase64(block.body);
  if (bytes === undefined) return notFlux('the data block is not valid base64');
  const claimed = attribute(block.tag, 'data-sha256');
  if (claimed !== undefined && claimed !== (await hasher.sha256(bytes))) {
    return err({ code: 'FILE_ZIP_INVALID', message: 'the archive does not match its data-sha256' });
  }
  return ok(bytes);
}
