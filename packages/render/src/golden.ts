// Normalized SVG of rendered content (NFR-REL-005, FR-SCR-001): the goldens under render/__golden__
// and the CLI's render test compare this text, not the HTML, so a golden changes only when what is
// drawn changes. From the static HTML (renderDocumentToHtml) each screen's content layer becomes one
// <svg>: element wrappers, placeholders and member containers are <g> groups carrying their id, kind
// and placement, drawn SVG is kept (in its own case), labels become <text>; attributes are sorted,
// numbers rounded to 1/100, and per-render ids (useId) numbered in order of appearance. Only markup
// our own views emit is read: a small tag scanner, no DOM.

type Tag = { readonly name: string; readonly attrs: ReadonlyMap<string, string>; readonly close: boolean; readonly selfClosing: boolean };
type Token = Tag | { readonly text: string };

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The void HTML elements our views may emit; they have no closing tag. */
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link']);

function* tokens(html: string): Generator<Token> {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[5] !== undefined) {
      yield { text: decode(m[5]) };
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of (m[3] ?? '').matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) attrs.set(a[1] as string, decode(a[2] ?? ''));
    // SVG names are case-sensitive (linearGradient): the source case is kept (M4.19 review F1)
    const name = m[2] as string;
    yield { name, attrs, close: m[1] === '/', selfClosing: m[4] === '/' || VOID.has(name.toLowerCase()) };
  }
}

/**
 * Numbers rounded to 1/100 (and -0 written as 0), so platform float noise cannot change a golden;
 * the digits of a hex colour (`#0f172a`) are not numbers.
 */
const round = (s: string) => s.replace(/(?<!#[\dA-Fa-f]*)-?\d*\.?\d+(?![\d.])/g, (n) => String(Math.round(Number(n) * 100) / 100 || 0));

/** Attributes that are names, not measurements: never rounded. */
const NAMES = new Set(['data-el-id', 'data-screen-id', 'data-kind', 'class', 'id']);

const hasClass = (tag: Tag, name: string) => (tag.attrs.get('class') ?? '').split(' ').includes(name);

/** `attrs` limited to `keep`, with `style` renamed data-place (a group's placement), plus `extra`. */
const pick = (attrs: ReadonlyMap<string, string>, keep: readonly string[], extra: readonly (readonly [string, string])[] = []) =>
  new Map([...[...attrs].filter(([k]) => keep.includes(k)).map(([k, v]) => [k === 'style' ? 'data-place' : k, v] as const), ...extra]);

/** What a source tag becomes, and whether the text inside it is kept. */
type Emitted = { readonly name: string; readonly attrs: ReadonlyMap<string, string>; readonly keepsText: boolean };

/** Writes the normalized lines of one page; ids are numbered across the page. */
class Writer {
  readonly lines: string[] = [];
  readonly #ids = new Map<string, string>();
  /** What every open source tag became (undefined when it is dropped). */
  #stack: (Emitted | undefined)[] = [];

  get #depth(): number {
    return this.#stack.filter(Boolean).length + 1;
  }

  get #inSvg(): boolean {
    return this.#stack.some((e) => e?.name === 'svg');
  }

  /** `value` with, unless a name, numbers rounded, and per-render ids numbered (a marker keeps its -start/-end). */
  #stable(name: string, value: string): string {
    // rounded first: a numbered id such as fx-id-0 must not read as the number -0
    const rounded = NAMES.has(name) ? value : round(value);
    // every per-render id the views emit: fills, markers, image masks and crops, stroke clips and masks (M5.15 review)
    return rounded.replace(/fx-(?:fill|marker|mask|crop|clip|edge|effects)-[\w-]+/g, (id) => {
      const suffix = /-(?:start|end)$/.exec(id)?.[0] ?? '';
      const base = id.slice(0, id.length - suffix.length);
      if (!this.#ids.has(base)) this.#ids.set(base, `fx-id-${this.#ids.size}`);
      return `${this.#ids.get(base)}${suffix}`;
    });
  }

  #open(name: string, attrs: ReadonlyMap<string, string>, selfClosing: boolean): void {
    const list = [...attrs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => ` ${k}="${encode(this.#stable(k, v))}"`);
    this.lines.push(`${'  '.repeat(this.#depth)}<${name}${list.join('')}${selfClosing ? '/' : ''}>`);
  }

  screen(id: string, content: readonly Token[]): void {
    this.lines.push(`<svg data-screen-id="${encode(id)}" xmlns="http://www.w3.org/2000/svg">`);
    this.#stack = [];
    for (const t of content) {
      if ('text' in t) this.#text(t.text);
      else if (t.close) this.#close();
      else this.#tag(t);
    }
    this.lines.push('</svg>');
  }

  #text(text: string): void {
    const trimmed = text.trim();
    if (trimmed && this.#stack.some((e) => e?.keepsText)) this.lines.push(`${'  '.repeat(this.#depth)}${encode(trimmed)}`);
  }

  /**
   * What a source tag becomes: drawn SVG as itself; an element wrapper as a <g> with its id, kind
   * and placement; a placeholder as a <g> with its role, label and text (FR-DOC-005); a members
   * container as a <g> with the offset that undoes its parent's placement; a label as <text>;
   * anything else is dropped (M4.19 review F2).
   */
  #emitted(t: Tag): Emitted | undefined {
    if (t.name === 'svg' || this.#inSvg) return { name: t.name, attrs: t.attrs, keepsText: true };
    if (hasClass(t, 'fx-el')) return { name: 'g', attrs: pick(t.attrs, ['data-el-id', 'data-kind', 'style']), keepsText: false };
    if (hasClass(t, 'fx-placeholder')) return { name: 'g', attrs: pick(t.attrs, ['role', 'aria-label'], [['class', 'fx-placeholder']]), keepsText: true };
    if (hasClass(t, 'fx-members')) return { name: 'g', attrs: pick(t.attrs, ['style'], [['class', 'fx-members']]), keepsText: false };
    if (hasClass(t, 'fx-label')) return { name: 'text', attrs: new Map([['class', 'fx-label']]), keepsText: true };
    // a connector label is placed on the screen: its placement is kept
    if (hasClass(t, 'fx-connector-label')) return { name: 'text', attrs: pick(t.attrs, ['style'], [['class', 'fx-connector-label']]), keepsText: true };
    return undefined;
  }

  #tag(t: Tag): void {
    const out = this.#emitted(t);
    if (out !== undefined) this.#open(out.name, out.attrs, t.selfClosing);
    if (!t.selfClosing) this.#stack.push(out);
  }

  #close(): void {
    const was = this.#stack.pop();
    if (was !== undefined) this.lines.push(`${'  '.repeat(this.#depth)}</${was.name}>`);
  }
}

/** True when `t` opens an element of class `name`. */
const opens = (t: Token, name: string): t is Tag => !('text' in t) && !t.close && hasClass(t, name);

/** The screen id `t` opens, if it opens a screen. */
const screenIdOf = (t: Token) => (opens(t, 'fx-screen') ? (t.attrs.get('data-screen-id') ?? '') : undefined);

/** How a token moves the nesting depth: +1 opens, -1 closes, 0 for text and self-closing tags. */
const step = (t: Token) => ('text' in t || t.selfClosing ? 0 : t.close ? -1 : 1);

/** The screens of `html` with the tokens of their content layer. */
function* screens(html: string): Generator<{ readonly id: string; readonly content: readonly Token[] }> {
  let id = '';
  let depth = 0;
  let content: Token[] = [];
  for (const t of tokens(html)) {
    if (depth === 0) {
      id = screenIdOf(t) ?? id;
      if (opens(t, 'fx-content')) [depth, content] = [1, []];
      continue;
    }
    depth += step(t);
    if (depth === 0) yield { id, content };
    else content.push(t);
  }
}

/**
 * The normalized SVG of the content drawn in `html` (static HTML from renderDocumentToHtml): one
 * `<svg data-screen-id>` per screen, deterministic across runs and platforms.
 *
 * @public
 */
export function normalizeSvg(html: string): string {
  const writer = new Writer();
  for (const screen of screens(html)) writer.screen(screen.id, screen.content);
  return `${writer.lines.join('\n')}\n`;
}
