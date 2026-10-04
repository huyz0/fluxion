// The URL allowlist of rich-text links (NFR-SEC-001, ADR-0025): what `@fluxion/schema` accepts as a link target in a document is exactly
// what a pasted or imported link may become. `http:`, `https:` and `mailto:` addresses and in-document `#screen:<id>` references pass;
// `javascript:`, `data:`, `vbscript:`, `file:`, relative and protocol-relative URLs and anything with markup characters do not.

const MAX_URL = 2048;
/** Characters a link target may not hold once cleaned: quotes, angle brackets and backslash (control characters and space are checked apart). */
const MARKUP = new Set(['"', "'", '`', '<', '>', '\\']);
/** `http(s)://host` with no user information (`user:pass@host` is how links are made to look like another site), `mailto:`, `#screen:<id>`. */
const ALLOWED = /^(?:https?:\/\/[^/?#@]+(?:[/?#]|$)|mailto:.|#screen:[A-Za-z0-9_-]{1,64}$)/i;

/** C0 and C1 controls, space and DEL. */
const isControl = (ch: string): boolean => {
  const c = ch.codePointAt(0) as number;
  return c <= 0x20 || (c >= 0x7f && c <= 0x9f);
};

/** `href` without leading and trailing controls and spaces, and without tabs and newlines inside, as a browser reads a URL. */
function cleaned(href: string): string {
  const chars = [...href];
  const first = chars.findIndex((ch) => !isControl(ch));
  const last = chars.findLastIndex((ch) => !isControl(ch));
  if (first < 0) return '';
  return chars
    .slice(first, last + 1)
    .filter((ch) => ch !== '\t' && ch !== '\n' && ch !== '\r')
    .join('');
}

/**
 * The link target `href` stands for, or undefined when it must not be a link. Like a browser, tabs and newlines inside the URL are
 * dropped and leading and trailing controls and spaces are trimmed before the scheme is read, so `java\tscript:` is read as the
 * `javascript:` it is. Stricter than a browser: C1 controls and DEL are trimmed too, a Unicode space (U+00A0, U+2028, U+FEFF) before the scheme
 * makes the URL relative and so refused, and user information (`https://user@host`) is refused.
 *
 * @public
 */
export function safeLinkUrl(href: string): string | undefined {
  const url = cleaned(href);
  if (url === '' || url.length > MAX_URL || !ALLOWED.test(url)) return undefined;
  return [...url].some((ch) => isControl(ch) || MARKUP.has(ch)) ? undefined : url;
}
