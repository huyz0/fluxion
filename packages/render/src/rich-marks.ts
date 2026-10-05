// What each rich-text mark draws as (FR-TXT-001, ADR-0013, M7.8): pure, so the rules that keep a
// document's text safe are tested without a DOM. A mark becomes an element (strong, em, a, …) or a
// styled span; every value a mark carries is checked again here, because a document can reach the
// renderer without being validated: a link only to http(s), mailto and in-document screens, a colour
// only a hex colour or a token, a font family only as a quoted CSS string.
import { type RichTextMark, safeLinkUrl } from '@fluxion/schema';
import { cssVarName, tokenPath } from '@fluxion/theme';

/**
 * One element a mark draws: its tag and, for a link, its target, and for the styled ones the CSS.
 *
 * @public
 */
export type MarkPlan = {
  /** The tag. */
  readonly tag: 'a' | 'strong' | 'em' | 'u' | 's' | 'code' | 'mark' | 'span';
  /** A link's target (already checked). */
  readonly href?: string;
  /** A link's title. */
  readonly title?: string;
  /** Inline CSS properties (camel-cased, as React takes them). */
  readonly style?: { readonly [property: string]: string };
};

/** The order marks nest in, outermost first: the same marks always give the same markup. */
const ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'color', 'size', 'font'] as const;

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TOKEN = /^\{[A-Za-z0-9_.-]+\}$/;

/** A token reference as the CSS variable the theme emits for it (`{color.primary}` → `var(--fx-color-primary)`). */
const tokenVar = (value: string): string | undefined => (TOKEN.test(value) ? `var(${cssVarName(tokenPath(value as `{${string}}`))})` : undefined);

/** A colour mark's value: a hex colour or a token. */
const cssColor = (value: unknown): string | undefined => (typeof value === 'string' ? (HEX.test(value) ? value : tokenVar(value)) : undefined);

/** A size mark's value: a positive finite number of px, or a token. */
function cssSize(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? `${value}px` : undefined;
  return typeof value === 'string' ? tokenVar(value) : undefined;
}

/** A family mark's value: a token, or a name as one quoted CSS string (`\` and `"` escaped, control characters dropped). */
function cssFamily(value: unknown): string | undefined {
  // tzap disable next-line ConditionalExpression,StringLiteral: an empty name is stripped to nothing below, which draws nothing too
  if (typeof value !== 'string' || value === '') return undefined;
  if (value.startsWith('{')) return tokenVar(value);
  const name = value.replace(/\p{Cc}/gu, '').replace(/[\\"]/g, (c) => `\\${c}`);
  return name === '' ? undefined : `"${name}"`;
}

type Attrs = { readonly [key: string]: unknown };

/** A mark that is an element of its own. */
const plain = (tag: MarkPlan['tag']) => (): MarkPlan => ({ tag });

/** A mark that is a span (or the highlight's `mark`) styled with `property`, when its value draws. */
const styled =
  (tag: 'span' | 'mark', attr: string, make: (value: unknown) => { readonly [property: string]: string } | undefined) =>
  (attrs: Attrs): MarkPlan | undefined => {
    const style = make(attrs[attr]);
    return style === undefined ? undefined : { tag, style };
  };

/** A one-property style from a value that may not draw. */
const prop =
  (property: string, convert: (value: unknown) => string | undefined) =>
  (value: unknown): { readonly [property: string]: string } | undefined => {
    const css = convert(value);
    return css === undefined ? undefined : { [property]: css };
  };

/** The plan of each known mark type, from its attributes. */
const PLANS: { readonly [type: string]: (attrs: Attrs) => MarkPlan | undefined } = {
  bold: plain('strong'),
  italic: plain('em'),
  underline: plain('u'),
  strike: plain('s'),
  code: plain('code'),
  link: (attrs) => {
    // the same policy as a pasted or imported link: no user information, markup characters or spaces
    const href = typeof attrs['href'] === 'string' ? safeLinkUrl(attrs['href']) : undefined;
    if (href === undefined) return undefined;
    return typeof attrs['title'] === 'string' ? { tag: 'a', href, title: attrs['title'] } : { tag: 'a', href };
  },
  highlight: styled('mark', 'color', (v) => {
    const color = cssColor(v);
    return color === undefined ? undefined : { backgroundColor: color, color: 'inherit' };
  }),
  color: styled('span', 'color', prop('color', cssColor)),
  size: styled('span', 'size', prop('fontSize', cssSize)),
  font: styled('span', 'family', prop('fontFamily', cssFamily)),
};

/** The plan of the single mark `mark`, or undefined when it draws nothing (unknown, or a value that is not safe). */
const plan = (mark: RichTextMark): MarkPlan | undefined => (Object.hasOwn(PLANS, mark.type) ? PLANS[mark.type]?.(mark.attrs ?? {}) : undefined);

/**
 * The elements to nest around a text node with `marks`, outermost first: each known mark once (the
 * first of its type), in the fixed order; an unknown mark, or one whose value is not safe, is left out
 * and its text stays plain (a `javascript:` link is plain text).
 *
 * @public
 */
export function planMarks(marks: readonly RichTextMark[] | undefined): readonly MarkPlan[] {
  const first = new Map<string, RichTextMark>();
  for (const m of marks ?? []) if (!first.has(m.type)) first.set(m.type, m);
  return ORDER.flatMap((type) => {
    const mark = first.get(type);
    const p = mark === undefined ? undefined : plan(mark);
    return p === undefined ? [] : [p];
  });
}
