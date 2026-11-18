// What the theme editor reads and writes (FR-THM-007, FR-THM-005, FR-THM-006, M20.11): the theme the open screen is drawn with (as the renderer picks it),
// a colour role set to a new colour, a generated palette applied, and the records that store the edit as one `document.applyRecords`.
import { type Store, screenThemeChoice, themeRecordId } from '@fluxion/core';
import type { RecordId, Style } from '@fluxion/schema';
import {
  applyPalette,
  BUILTIN_VARIANTS,
  generatePalette,
  isToken,
  LIGHT_THEME,
  oklchToCss,
  type Palette,
  type PaletteRole,
  parseColor,
  resolveStyle,
  type Theme,
  type Token,
  type TokenGroup,
  themeOf,
  toCssVars,
} from '@fluxion/theme';

type Rec = { readonly id: string; readonly type: string; readonly [field: string]: unknown };

/**
 * The theme the editor edits: the one the open screen is drawn with. `holder` is the record whose `themeId` chose it (the screen's
 * override, else its applied master's, else the document's, as the renderer picks); `recordId` is undefined when that id names no
 * readable theme record (the light theme is drawn).
 */
export type EditedTheme = { readonly theme: Theme; readonly recordId: string | undefined; readonly holder: string | undefined };

const recordOf = (store: Store, id: unknown): Rec | undefined =>
  typeof id === 'string' && id !== '' ? (store.get(id as RecordId) as Rec | undefined) : undefined;
/** The theme the screen `screenId` is drawn with, as core's `screenThemeChoice` picks it (ADR-0152, ADR-0054; M20.39). */
export function editedTheme(store: Store, screenId: string | undefined): EditedTheme {
  const { holder, themeId } = screenThemeChoice(store, screenId as RecordId | undefined);
  const record = recordOf(store, themeId);
  const theme = record?.type === 'theme' ? themeOf(record) : undefined;
  return theme === undefined || record === undefined ? { theme: LIGHT_THEME, recordId: undefined, holder } : { theme, recordId: record.id, holder };
}

/** `theme-<name>`, or with the first free `-2`, `-3`… when a record holds it already (it is never overwritten). */
function freeId(store: Store, name: string): string {
  const base = themeRecordId(name);
  let id = base;
  for (let n = 2; store.get(id as RecordId) !== undefined; n += 1) id = `${base}-${n}`;
  return id;
}

/** The fields of a theme record that hold `theme`. */
const body = (theme: Theme) => ({
  name: theme.name,
  tokens: theme.tokens,
  ...(theme.defaults === undefined ? {} : { defaults: theme.defaults }),
  ...(theme.tableStyles === undefined ? {} : { tableStyles: theme.tableStyles }),
});

/**
 * The `document.applyRecords` arguments that store `next` as the edited theme: its record rewritten (its other fields kept); with no
 * readable record, a new theme record under a free id that the record which chose the theme now points at (so the canvas draws the
 * edit), in the same write: the first edit too is one undo step.
 */
export function themeWrite(store: Store, edited: EditedTheme, next: Theme): { readonly puts: readonly Rec[]; readonly deletes: readonly string[] } {
  if (edited.recordId !== undefined) {
    const record = recordOf(store, edited.recordId) as Rec;
    return { puts: [{ ...record, ...body(next) }], deletes: [] };
  }
  const id = freeId(store, next.name);
  const holder = recordOf(store, edited.holder);
  const theme = { id, type: 'theme', ...body(next) };
  return { puts: holder === undefined ? [theme] : [theme, { ...holder, themeId: id }], deletes: [] };
}

/** The colour group of `theme`'s tokens (empty when it has none). */
function colorGroup(theme: Theme): TokenGroup {
  const group = theme.tokens['color'];
  return group !== undefined && !isToken(group) ? group : {};
}

/** `theme` with the colour role `role` set to the literal `hex` (its description kept; an alias becomes a literal). */
export function withColor(theme: Theme, role: string, hex: string): Theme {
  const group = colorGroup(theme);
  const prev = group[role];
  const token: Token = { ...(prev !== undefined && isToken(prev) ? prev : {}), $type: 'color', $value: hex };
  return { ...theme, tokens: { ...theme.tokens, color: { ...group, [role]: token } } };
}

/** The colour role `role` of `theme` as `#rrggbb` (what a colour input shows); black when it does not resolve to a readable colour. */
export function colorOf(theme: Theme, role: string): string {
  const css = toCssVars(theme)[`--fx-color-${role}`];
  const color = css === undefined ? undefined : parseColor(css);
  return color === undefined ? '#000000' : oklchToCss({ ...color, alpha: 1 });
}

/** What the palette generator is asked: up to three seed colours (blank ones skipped), the locked roles and the shuffle. */
export type PaletteAsk = { readonly seeds: readonly string[]; readonly locked: ReadonlySet<PaletteRole>; readonly shuffle: number };

/** `theme` with a palette generated from `ask` applied (locked roles keep their current colour), or the generator's message. */
export function generated(theme: Theme, ask: PaletteAsk): { readonly theme: Theme; readonly palette: Palette } | { readonly error: string } {
  const locks = Object.fromEntries([...ask.locked].map((role) => [role, colorOf(theme, role)]));
  const palette = generatePalette({ seeds: ask.seeds.map((s) => s.trim()).filter((s) => s !== ''), locks, shuffle: ask.shuffle });
  return palette.ok ? { theme: applyPalette(theme, palette.value), palette: palette.value } : { error: palette.error.message };
}

/** A shape variant as the theme draws it: its fill, outline and text colour as CSS (the theme's variables), for a preview. */
export type VariantPreview = { readonly name: string; readonly fill: string; readonly stroke: string; readonly strokeWidth: string; readonly text: string };

/** The previews of the shape variants (the built-in four, then any the theme adds), resolved against `theme`. */
export function variantPreviews(theme: Theme): readonly VariantPreview[] {
  const own = theme.defaults?.['shape']?.['variants'];
  const names = [...new Set([...Object.keys(BUILTIN_VARIANTS['shape'] ?? {}), ...(typeof own === 'object' && own !== null ? Object.keys(own) : [])])];
  return names.map((name) => {
    const { style } = resolveStyle({ variant: name } as Style, { kind: 'shape' }, theme);
    const fill = style.fill.type === 'color' ? style.fill.css : 'transparent';
    return { name, fill, stroke: style.stroke.color, strokeWidth: style.stroke.width, text: style.font.color };
  });
}
