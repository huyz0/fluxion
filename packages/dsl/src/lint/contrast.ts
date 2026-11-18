// The contrast rule (NFR-A11Y-005): each element's colours against what the view draws behind them, on the theme and page
// background of its screen as the renderer picks them (FR-THM-004, ADR-0152, ADR-0054).
import { appliedMaster, createStore, type ReadView, screenThemeChoice } from '@fluxion/core';
import type { DocumentFile, RecordId, Style } from '@fluxion/schema';
import {
  type ContrastIssue,
  checkContrast,
  parseColor,
  type ResolvedPaint,
  type ResolvedStyle,
  resolveBackground,
  resolveStyle,
  type Theme,
  textContrastKind,
  themeOf,
  toCssVars,
} from '@fluxion/theme';
import { finding } from './rules-layout.js';
import type { LintFinding, LintRule } from './types.js';
import { plainText, type Rec, recordsOf } from './view.js';

type Vars = { readonly [name: string]: string };

/**
 * A contrast issue of an element (NFR-A11Y-005): the check that fails, the nearest passing colour, and the style field the fix sets.
 *
 * @public
 */
export type ElementContrastIssue = ContrastIssue & {
  /** The style field whose colour fails: the text colour, or the outline's. */
  readonly field: 'font.color' | 'stroke.color';
};

/** What a screen draws its elements on: its theme, the theme's variables, and the page colour (undefined for a gradient or image). */
type ScreenContext = { readonly theme: Theme; readonly vars: Vars; readonly page: string | undefined };

const VAR = /^var\((--[A-Za-z0-9_-]+)\)$/;

/** The literal colour behind a resolved CSS colour: a `var(--fx-…)` through the theme's variables, else the value itself. */
function literal(css: string, vars: Vars): string {
  const name = VAR.exec(css)?.[1];
  return name === undefined ? css : (vars[name] ?? css);
}

/** The CSS variables of each theme seen (a theme object does not change). */
const VARS = new WeakMap<Theme, Vars>();
function varsOf(theme: Theme): Vars {
  const known = VARS.get(theme);
  if (known !== undefined) return known;
  const vars = toCssVars(theme);
  VARS.set(theme, vars);
  return vars;
}

/** Whether a literal colour paints nothing (`transparent`, or alpha 0). */
const clear = (css: string): boolean => css.trim().toLowerCase() === 'transparent' || parseColor(css)?.alpha === 0;

const recOf = (doc: DocumentFile, id: unknown): Rec | undefined => (typeof id === 'string' ? (doc.records[id as RecordId] as Rec | undefined) : undefined);

/** The theme record `id` names, read as a theme; undefined when it names none or an invalid one (the view draws the light theme). */
function themeRecord(doc: DocumentFile, id: unknown): Theme | undefined {
  const r = recOf(doc, id);
  return r?.type === 'theme' ? themeOf(r) : undefined;
}

/**
 * The context of screen `screenId`: the theme core's `screenThemeChoice` names (its override, else its applied master's, else the
 * document's), else `fallback`;
 * the page its own background, else its master's, a background painting nothing showing the theme's `color.background`.
 */
function screenContext(doc: DocumentFile, view: ReadView, screenId: unknown, fallback: Theme | undefined): ScreenContext | undefined {
  const screen = recOf(doc, screenId);
  const id = screen?.id as RecordId | undefined;
  const master = recOf(doc, id === undefined ? undefined : appliedMaster(view, id).master);
  // the theme as the view picks it (core's one rule, M20.39)
  const theme = themeRecord(doc, screenThemeChoice(view, id).themeId) ?? fallback;
  if (theme === undefined) return undefined;
  const vars = varsOf(theme);
  const own = screen?.['background'] !== undefined || master === undefined;
  const paint = resolveBackground((own ? screen?.['background'] : master['background']) as Style['fill'] | undefined, theme).paint;
  return { theme, vars, page: pageColour(paint, vars) };
}

/** The literal colour a page paint shows; the theme's background where it paints nothing, undefined for a gradient or image. */
function pageColour(paint: ResolvedPaint, vars: Vars): string | undefined {
  const background = vars['--fx-color-background'] ?? '#ffffff';
  if (paint.type === 'none') return background;
  if (paint.type !== 'color') return undefined;
  const css = literal(paint.css, vars);
  return clear(css) ? background : css;
}

/** The colour an element's fill shows its text on: the fill when solid, the page when it has none; undefined for a gradient or image. */
function behindText(fill: ResolvedPaint, page: string | undefined, vars: Vars): string | undefined {
  if (fill.type === 'none') return page;
  if (fill.type !== 'color') return undefined;
  const css = literal(fill.css, vars);
  return clear(css) ? page : css;
}

/** The issue of an element's text against its solid fill, or the page when it has none. */
function textIssue(style: ResolvedStyle, at: ScreenContext): ElementContrastIssue | undefined {
  const behind = behindText(style.fill, at.page, at.vars);
  if (behind === undefined) return undefined;
  const kind = textContrastKind(Number.parseFloat(literal(style.font.size, at.vars)), Number.parseFloat(literal(style.font.weight, at.vars)));
  const issue = checkContrast({ kind, color: literal(style.font.color, at.vars), against: behind });
  return issue === undefined ? undefined : { ...issue, field: 'font.color' };
}

/** The issue of the outline of a connector, or of an element with no fill, against the page. */
function outlineIssue(style: ResolvedStyle, kind: string, at: ScreenContext): ElementContrastIssue | undefined {
  const { vars, page } = at;
  const unfilled = style.fill.type === 'none' || (style.fill.type === 'color' && clear(literal(style.fill.css, vars)));
  const stroke = literal(style.stroke.color, vars);
  if (page === undefined || (kind !== 'connector' && !unfilled)) return undefined;
  if (!(Number.parseFloat(literal(style.stroke.width, vars)) > 0) || clear(stroke)) return undefined;
  const issue = checkContrast({ kind: 'stroke', color: stroke, against: page });
  return issue === undefined ? undefined : { ...issue, field: 'stroke.color' };
}

/** The issues of element record `e` on its screen's context. */
function issuesOf(e: Rec, at: ScreenContext): readonly ElementContrastIssue[] {
  const kind = String(e['kind']);
  const defId = e['defId'];
  // a shape's definition id: the theme's defaults for that definition and its variants apply, as the view draws them (ADR-0055)
  const of = { kind, ...(typeof defId === 'string' ? { defId } : {}) };
  const { style } = resolveStyle(e['style'] as Style | undefined, of, at.theme);
  const text = plainText(e['text']) !== '' && kind !== 'connector' ? textIssue(style, at) : undefined;
  const outline = outlineIssue(style, kind, at);
  return [...(text === undefined ? [] : [text]), ...(outline === undefined ? [] : [outline])];
}

/** A read view of `doc` for the master lookup (ADR-0054). */
const viewOf = (doc: DocumentFile): ReadView => createStore(doc, { validate: false, policy: 'read-only' });

/**
 * The contrast issues of element `id` of `doc` (NFR-A11Y-005): its text against its solid fill, or against the page when it has
 * no fill, at 4.5:1 or 3:1 for large text; and the outline of a connector, or of an element with no fill, against the page at 3:1.
 * The theme and the page are its screen's, as the view draws them: the screen's theme override, else its applied master's, else
 * the document's, else `fallback`; the screen's background, else its master's, else the theme's `color.background`. A page
 * painted with a gradient or an image is not checked against. Each issue carries the nearest passing colour (theme's `checkContrast`).
 * `view`, a read view of `doc` the caller already holds, saves building one per call.
 *
 * @example
 * ```ts
 * for (const issue of elementContrastIssues(doc, id, LIGHT_THEME)) console.log(issue.field, issue.ratio, issue.fix);
 * ```
 * @public
 */
export function elementContrastIssues(doc: DocumentFile, id: string, fallback?: Theme, view?: ReadView): readonly ElementContrastIssue[] {
  const e = recOf(doc, id);
  if (e?.type !== 'element') return [];
  const at = screenContext(doc, view ?? viewOf(doc), e['screenId'], fallback);
  return at === undefined ? [] : issuesOf(e, at);
}

/** The finding of one issue of element `id`. */
function contrastFinding(id: string, issue: ElementContrastIssue): LintFinding {
  const what = issue.field === 'font.color' ? 'text' : 'outline';
  const message = `the ${what} of ${id} has contrast ${issue.ratio.toFixed(2)}:1 (needs ${issue.target}:1)`;
  return {
    ...finding('FLX_LINT_CONTRAST', id, message, `use ${issue.fix}, or pick colours with more contrast`),
    path: `/records/${id}/style/${issue.field.replace('.', '/')}`,
  };
}

export const CONTRAST: LintRule = {
  id: 'CONTRAST',
  code: 'FLX_LINT_CONTRAST',
  severity: 'warning',
  weight: 6,
  describe: 'text or an outline with too little contrast (WCAG AA: text 4.5:1, large text and outlines 3:1)',
  check(doc, ctx) {
    const view = ctx.view ?? viewOf(doc);
    const screens = new Map<unknown, ScreenContext | undefined>();
    const contextOf = (screenId: unknown): ScreenContext | undefined => {
      if (!screens.has(screenId)) screens.set(screenId, screenContext(doc, view, screenId, ctx.theme));
      return screens.get(screenId);
    };
    return recordsOf(doc, 'element')
      .filter((e) => e['hidden'] !== true)
      .flatMap((e) => {
        const at = contextOf(e['screenId']);
        return at === undefined ? [] : issuesOf(e, at).map((issue) => contrastFinding(e.id, issue));
      });
  },
};
