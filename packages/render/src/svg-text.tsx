// Text on the svg surface (ADR-0056 item 3, FR-EXP-004): a label laid out by core's layoutStyled with the host's measurer, so the
// lines break where they break everywhere (FR-TXT-002), drawn as one `<text>` whose lines are `<tspan x y>` and whose pieces are
// nested `<tspan>`s with an explicit `x`, in literal font attributes. No `foreignObject`, ever.
import { type FontSpec, type LaidOutLine, type LaidOutPiece, layoutStyled, type TextMeasurer } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import type { ResolvedFont, Theme } from '@fluxion/theme';
import { createElement, type ReactNode } from 'react';
import { type BlockPaint, type ListMarker, richBlocks } from './rich-layout.js';
import type { MarkPlan } from './rich-marks.js';
import { lit, n3, opacityOf } from './svg-paint.js';
import { concreteFont } from './text-measurer.js';

/** Where a label is drawn: its box (in the view's coordinates) and the padding inside it. */
export type LabelBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly padding: number };

/** How far down the free height a label sits for a vertical alignment. */
const DOWN: { readonly [align: string]: number } = { top: 0, middle: 0.5, bottom: 1 };

/** A top-level bullet (disc) and a nested one (circle), as the html leaf's content css draws them (`ul ul`, `ol ul`: circle). */
const DISC = '\u2022';
const CIRCLE = '\u25e6';

/** A link's colour where no colour mark inside it sets one: the browser's default link colour, as the html leaf's bare `<a>`. */
const LINK_COLOUR = '#0000ee';

/** A piece's font attributes where they differ from the `<text>`'s own. */
function fontAttrs(font: FontSpec, base: FontSpec) {
  return {
    ...(font.family === base.family ? {} : { fontFamily: font.family }),
    ...(font.size === base.size ? {} : { fontSize: n3(font.size) }),
    ...(font.weight === base.weight ? {} : { fontWeight: font.weight }),
    ...(font.style === base.style ? {} : { fontStyle: font.style }),
  };
}

/**
 * What a piece's marks draw on its `<tspan>`, in literals: underline and strike as `text-decoration`, a colour as its fill. A link
 * (the outermost mark) is underlined in the default link colour, as the html leaf's bare `<a>` is; a colour mark inside it wins.
 */
function markAttrs(plans: readonly MarkPlan[], theme: Theme) {
  const has = (tag: string) => plans.some((p) => p.tag === tag);
  const link = has('a');
  const lines = [...(link || has('u') ? ['underline'] : []), ...(has('s') ? ['line-through'] : [])];
  const color = plans.find((p) => p.tag === 'span' && p.style?.['color'] !== undefined)?.style?.['color'];
  const fill = color === undefined ? (link ? LINK_COLOUR : '') : lit(color, theme);
  return { ...(lines.length === 0 ? {} : { textDecoration: lines.join(' ') }), ...(fill === '' ? {} : { fill }) };
}

/** A link a standalone file can follow (http, https, mailto); an in-document screen link draws as its text. */
const outbound = (plans: readonly MarkPlan[]): string | undefined => {
  const href = plans.find((p) => p.tag === 'a')?.href;
  return href !== undefined && !href.startsWith('#') ? href : undefined;
};

/** The highlight colour of a piece's marks, in literals; undefined when it has none. */
const highlight = (plans: readonly MarkPlan[], theme: Theme): string | undefined => {
  const css = plans.find((p) => p.tag === 'mark')?.style?.['backgroundColor'];
  const value = css === undefined ? '' : lit(css, theme);
  return value === '' ? undefined : value;
};

/** A list marker's text: a disc at the top level, a circle nested, or its number. */
const markerText = (m: ListMarker): string => (m.ordered ? `${m.n}.` : m.level > 1 ? CIRCLE : DISC);

/** Where a label's lines are placed: the text box's left and top in the view's coordinates. */
type Origin = { readonly left: number; readonly top: number };

/** The marks of piece `p` of `line`. */
const plansOf = (paints: readonly BlockPaint[], line: LaidOutLine, p: LaidOutPiece): readonly MarkPlan[] => paints[line.block]?.runs[p.run] ?? [];

/** The highlight rectangles behind the pieces that carry one: each piece's own ascent and descent around the line's baseline. */
function Highlights(props: {
  readonly lines: readonly LaidOutLine[];
  readonly paints: readonly BlockPaint[];
  readonly at: Origin;
  readonly theme: Theme;
  readonly measurer: TextMeasurer;
  readonly opacity: number;
}): ReactNode {
  const { lines, paints, at, theme, measurer, opacity } = props;
  const rects = lines.flatMap((line) =>
    line.pieces.flatMap((p) => {
      const color = highlight(plansOf(paints, line, p), theme);
      if (color === undefined) return [];
      const m = measurer.measure(p.text, p.font);
      return [{ x: at.left + p.x, y: at.top + line.baseline - m.ascent, w: p.width, h: m.ascent + m.descent, color }];
    }),
  );
  if (rects.length === 0) return null;
  return (
    <g opacity={opacity === 1 ? undefined : opacity}>
      {rects.map((r, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: highlights have no identity but their order
        <rect key={k} x={n3(r.x)} y={n3(r.y)} width={n3(r.w)} height={n3(r.h)} fill={r.color} />
      ))}
    </g>
  );
}

/** One piece: a nested `<tspan>` at its `x` in its font and marks, inside an `<a>` when it links out. */
function Piece(props: {
  readonly p: LaidOutPiece;
  readonly plans: readonly MarkPlan[];
  readonly base: FontSpec;
  readonly left: number;
  readonly theme: Theme;
}): ReactNode {
  const { p, plans, base, left, theme } = props;
  const span = (
    <tspan x={n3(left + p.x)} {...fontAttrs(p.font, base)} {...markAttrs(plans, theme)}>
      {p.text}
    </tspan>
  );
  const href = outbound(plans);
  // an svg `<a>` (JSX types `a` as the html element)
  return href === undefined ? span : createElement('a', { xlinkHref: href }, span);
}

/**
 * The text `doc` in `font` laid out in `box` (its padding inside), aligned as the font and each block say, at `size` when a fit chose
 * one; nothing for no text. Marks draw as ADR-0056 item 3 says: underline and strike as `text-decoration`, a colour as the piece's
 * fill, a highlight as a rectangle behind its piece, a link as `<a xlink:href>`; a list item's first line has its marker before it.
 */
export function SvgLabel(props: {
  readonly doc: RichTextDoc | undefined;
  readonly font: ResolvedFont;
  readonly opacity: string;
  readonly box: LabelBox;
  readonly theme: Theme;
  readonly measurer: TextMeasurer;
  readonly size?: number | undefined;
}): ReactNode {
  const { box, theme, measurer } = props;
  const { blocks, paints } = richBlocks(props.doc, theme);
  if (blocks.every((b) => b.runs.every((r) => r.text === ''))) return null;
  const concrete = concreteFont(props.font, theme);
  const base: FontSpec = { ...concrete, size: props.size ?? concrete.size, weight: concrete.weight ?? 400, style: concrete.style ?? 'normal' };
  const inner = { w: Math.max(0, box.w - 2 * box.padding), h: Math.max(0, box.h - 2 * box.padding) };
  const laid = layoutStyled(blocks, base, measurer, { maxWidth: inner.w, align: lit(props.font.align, theme) });
  const at = { left: box.x + box.padding, top: box.y + box.padding + (inner.h - laid.height) * (DOWN[lit(props.font.verticalAlign, theme)] ?? 0.5) };
  const lines = laid.lines.filter((l) => l.text !== '');
  const opacity = opacityOf(props.opacity, theme);
  const marked = new Set<number>();
  const text = (
    <text
      xmlSpace="preserve"
      textRendering="geometricPrecision"
      fontFamily={base.family}
      fontSize={n3(base.size)}
      fontWeight={base.weight}
      fontStyle={base.style}
      fill={lit(props.font.color, theme) || '#000000'}
      opacity={opacity === 1 ? undefined : opacity}
    >
      {lines.map((line, i) => {
        const marker = marked.has(line.block) ? undefined : paints[line.block]?.marker;
        marked.add(line.block);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a label's lines have no identity but their order
          <tspan key={i} x={n3(at.left + line.x)} y={n3(at.top + line.baseline)}>
            {marker === undefined ? null : (
              <tspan x={n3(at.left + line.x - 0.4 * base.size)} textAnchor="end">
                {markerText(marker)}
              </tspan>
            )}
            {line.pieces.map((p, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces have no identity but their order
              <Piece key={k} p={p} plans={plansOf(paints, line, p)} base={base} left={at.left} theme={theme} />
            ))}
          </tspan>
        );
      })}
    </text>
  );
  return (
    <>
      <Highlights lines={lines} paints={paints} at={at} theme={theme} measurer={measurer} opacity={opacity} />
      {text}
    </>
  );
}
