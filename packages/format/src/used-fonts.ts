// Which of a document's font assets its text uses (FR-THM-008, NFR-SIZE-004, ADR-0022): the families named by element styles and by rich-text
// font marks, and by the theme's own defaults, with token references (`{font.body}`) followed to the families they stand for. A font asset is
// used when its family is one of those; every face of a used family is kept (a bold mark or an italic run picks a face by weight and style,
// and no subsetting happens in M10, ADR-0025). A document with no theme record falls back on the built-in theme's defaults, which this package
// cannot read, so there every font is kept: embedding one font too many is a size cost, dropping one in use is a wrong render.
import type { DocumentFile, RecordId } from '@fluxion/schema';

type Json = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The field `key` of `o` (a method, so no index-signature access for the type checker and no literal key for the linter to rewrite). */
const field = (o: Json, key: string): unknown => o[key];

/** The most nested values read from one record, and the most references followed: hostile input cannot make the walk long. */
const MAX_DEPTH = 64;
const MAX_HOPS = 8;

/** A token reference's path (`{font.body}` is `font.body`), or undefined for any other string. */
const tokenPath = (value: string): string | undefined => /^\{([^{}]+)\}$/.exec(value.trim())?.[1];

/** A family name as compared: trimmed, runs of whitespace as one space, lower case. */
export const normalise = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The families a CSS font-family list names, unquoted and lower case (`"Inter", system-ui` is `inter`, `system-ui`). */
const familiesOfList = (list: string): string[] =>
  list
    .split(',')
    .map((name) => normalise(name.trim().replace(/^(["'])(.*)\1$/, '$2')))
    .filter((name) => name !== '');

/** The value of the token at `path` (dot separated) in the token tree `tokens`, or undefined. */
function tokenValue(tokens: unknown, path: string): unknown {
  let node: unknown = tokens;
  for (const key of path.split('.')) {
    if (!isObject(node)) return undefined;
    node = field(node, key);
  }
  return isObject(node) ? field(node, '$value') : undefined;
}

/** The family names `value` stands for: a name or list, a token reference, or a token whose value is a list of names. */
function resolve(value: unknown, tokens: unknown, hops = 0): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => (typeof v === 'string' ? familiesOfList(v) : []));
  if (typeof value !== 'string') return [];
  const path = tokenPath(value);
  if (path === undefined) return familiesOfList(value);
  return hops >= MAX_HOPS ? [] : resolve(tokenValue(tokens, path), tokens, hops + 1);
}

/** The families `value` names directly: a rich-text `font` mark's family, or the family of each `font` object among its own fields. */
function directFamilies(value: Json, tokens: unknown): string[] {
  const out: string[] = [];
  const attrs = field(value, 'attrs');
  if (field(value, 'type') === 'font' && isObject(attrs)) out.push(...resolve(field(attrs, 'family'), tokens));
  const font = field(value, 'font');
  if (isObject(font)) out.push(...resolve(field(font, 'family'), tokens));
  return out;
}

/** Every family a record names: in a `font` object's `family`, or in a rich-text `font` mark's attributes, at any depth. */
function collect(value: unknown, tokens: unknown, out: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, tokens, out, depth + 1);
  } else if (isObject(value)) {
    for (const name of directFamilies(value, tokens)) out.add(name);
    for (const child of Object.values(value)) collect(child, tokens, out, depth + 1);
  }
}

/** Whether the document record names a theme that exists: without one the defaults in force are the built-in theme's, which cannot be read here. */
function hasDocumentTheme(records: readonly Json[], doc: DocumentFile): boolean {
  const id = field(records.find((r) => field(r, 'type') === 'document') ?? {}, 'themeId');
  return typeof id === 'string' && field((doc.records[id as RecordId] as unknown as Json | undefined) ?? {}, 'type') === 'theme';
}

const isElementOrScreen = (r: Json): boolean => field(r, 'type') === 'element' || field(r, 'type') === 'screen';

/** The theme records the document and its screens name (a screen's `themeId` overrides the document's, FR-THM-004), the document's first. */
function themesOf(records: readonly Json[], all: DocumentFile): Json[] {
  const named = [...records.filter((r) => field(r, 'type') === 'document'), ...records.filter((r) => field(r, 'type') === 'screen')];
  const themes: Json[] = [];
  for (const record of named) {
    const id = field(record, 'themeId');
    const theme = typeof id === 'string' ? (all.records[id as RecordId] as unknown as Json | undefined) : undefined;
    if (theme !== undefined && field(theme, 'type') === 'theme' && !themes.includes(theme)) themes.push(theme);
  }
  return themes;
}

/**
 * The font families (lower case, whitespace normalised) the text of `doc` uses, or undefined when that cannot be told (the document has no
 * theme record) and every font asset has to be kept. Every theme the document or a screen names is read, and an element's references are
 * followed through each of them: a font used under any theme is kept.
 *
 * @public
 */
export function usedFontFamilies(doc: DocumentFile): ReadonlySet<string> | undefined {
  const records = Object.values(doc.records) as readonly Json[];
  const themes = themesOf(records, doc);
  if (!hasDocumentTheme(records, doc)) return undefined;
  const used = new Set<string>();
  for (const theme of themes) {
    const tokens = field(theme, 'tokens');
    for (const record of records.filter(isElementOrScreen)) collect(record, tokens, used);
    // the theme's own defaults and kind styles apply to every element that sets nothing itself
    for (const [key, value] of Object.entries(theme)) if (key !== 'tokens') collect(value, tokens, used);
  }
  return used;
}
