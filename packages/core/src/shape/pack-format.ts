// Pack format versions as one rule (ADR-0210, M18.211): 1.1 adds exact artwork fonts (ADR-0192) and 1.2 is 1.1 plus category
// display names, so every reader that keeps fonts asks `packHasFonts`, never compares a version string. A category's display name
// is its `name` when the pack gives one, else `categoryTitle(slug)`: the encoder writes a name only when it differs from that.

/** A pack format version that carries exact artwork fonts: 1.1, and 1.2 (1.1 plus category names). @public */
export type ShapePackFontFormat = '1.1' | '1.2';

/** Anything with a pack format version: an index, a category or a saved subset. @public */
export type ShapePackVersioned = {
  /** Its pack format version. */
  readonly formatVersion: string;
};

/** A `T` whose format version carries exact artwork fonts. @public */
export type ShapePackWithFonts<T extends ShapePackVersioned> = T & {
  /** Format 1.1 or 1.2. */
  readonly formatVersion: ShapePackFontFormat;
};

/** Whether `pack` (an index, category or saved subset) carries exact artwork fonts: format 1.1 or 1.2. @public */
export function packHasFonts<T extends ShapePackVersioned>(pack: T): pack is ShapePackWithFonts<T> {
  return isFontFormat(pack.formatVersion);
}

/** Whether the format version `version` carries exact artwork fonts (`'1.1'` or `'1.2'`). @public */
export const isFontFormat = (version: unknown): version is ShapePackFontFormat => version === '1.1' || version === '1.2';

/** The longest category display name, in UTF-16 code units. @public */
export const CATEGORY_NAME_MAX = 80;

/**
 * The title form of a category slug: its words, each capitalised, joined by spaces (`arrows-pointers` → `Arrows Pointers`). A pack
 * 1.2 category whose name equals this, or its slug, writes no name; the library panel shows it for a category with none.
 * @public
 */
export function categoryTitle(slug: string): string {
  return slug
    .split('-')
    .filter((word) => word !== '')
    .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
    .join(' ');
}

// C0 and C1 controls and DEL; a name is a single line of display text
// biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what this matches
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Why `name` is not a valid category display name (non-empty, at most 80 code units, NFC, no control character), or undefined. @public */
export function categoryNameProblem(name: string): string | undefined {
  if (name.trim() === '') return 'category name must not be blank';
  if (name.length > CATEGORY_NAME_MAX) return `category name must be at most ${CATEGORY_NAME_MAX} characters`;
  if (name.normalize('NFC') !== name) return 'category name must be NFC';
  if (CONTROL.test(name)) return 'category name must not hold a control character';
  return undefined;
}
