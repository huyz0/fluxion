// minifySvg (FR-AST-002, ADR-0025): the smaller form of an SVG that already went through `sanitizeSvg`, without a general optimiser (no SVGO, no
// path rewriting: nothing here changes what is drawn). It drops comments and the whitespace between elements, and keeps every character of text
// that is shown (`text`, `tspan`, `title`, `desc`), since a space there is drawn. A string it cannot read as tags and text is returned as it came.

/** The elements whose text is shown: whitespace inside them is content. */
const TEXTUAL = new Set(['text', 'tspan', 'title', 'desc']);

/** The element name a start or end tag opens or closes, in lower case; empty for anything else. */
function nameOf(tag: string): string {
  const m = /^<\/?([A-Za-z][\w:.-]*)/.exec(tag);
  return m === null ? '' : (m[1] as string).toLowerCase();
}

/** A piece of the text: a tag (`<…>`) or the text between tags. */
type Piece = { readonly tag: boolean; readonly text: string };

/** The pieces of `svg` without its comments, or undefined when a comment or a tag is not closed. */
function pieces(svg: string): Piece[] | undefined {
  const out: Piece[] = [];
  let at = 0;
  while (at < svg.length) {
    const open = svg.indexOf('<', at);
    if (open < 0) {
      out.push({ tag: false, text: svg.slice(at) });
      break;
    }
    out.push({ tag: false, text: svg.slice(at, open) });
    const comment = svg.startsWith('<!--', open);
    const close = comment ? svg.indexOf('-->', open + 4) : svg.indexOf('>', open);
    if (close < 0) return undefined;
    if (!comment) out.push({ tag: true, text: svg.slice(open, close + 1) });
    at = close + (comment ? 3 : 1);
  }
  return out;
}

/** How a tag changes the depth inside shown text: +1 for the start of one, -1 for its end, else 0. */
function textualDepth(tag: string): number {
  if (!TEXTUAL.has(nameOf(tag))) return 0;
  if (tag.startsWith('</')) return -1;
  return tag.endsWith('/>') ? 0 : 1;
}

/**
 * `svg` with its comments and the whitespace between elements removed. Text inside `text`, `tspan`, `title` and `desc` is kept as written.
 *
 * @public
 */
export function minifySvg(svg: string): string {
  const parts = pieces(svg);
  if (parts === undefined) return svg;
  let textual = 0;
  const out: string[] = [];
  for (const part of parts) {
    if (part.tag) textual = Math.max(0, textual + textualDepth(part.text));
    out.push(part.tag || textual > 0 ? part.text : part.text.trim());
  }
  return out.join('');
}
