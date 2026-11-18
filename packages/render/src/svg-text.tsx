// Text on the svg surface (ADR-0056 item 3, FR-EXP-004): a label laid out by core's layoutStyled with the host's measurer, so the
// lines break where they break everywhere (FR-TXT-002), drawn as one `<text>` whose lines are `<tspan x y>` and whose pieces are
// nested `<tspan>`s with an explicit `x`, in literal font attributes. No `foreignObject`, ever.
import { type FontSpec, layoutStyled, type TextMeasurer } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import type { ResolvedFont, Theme } from '@fluxion/theme';
import type { ReactNode } from 'react';
import { styledBlocks } from './rich-layout.js';
import { lit, n3, opacityOf } from './svg-paint.js';
import { concreteFont } from './text-measurer.js';

/** Where a label is drawn: its box (in the view's coordinates) and the padding inside it. */
export type LabelBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly padding: number };

/** How far down the free height a label sits for a vertical alignment. */
const DOWN: { readonly [align: string]: number } = { top: 0, middle: 0.5, bottom: 1 };

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
 * The text `doc` in `font` laid out in `box` (its padding inside), aligned as the font says, at `size` when a fit chose one; nothing
 * for no text.
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
  const { box, theme } = props;
  const blocks = styledBlocks(props.doc, theme);
  if (blocks.every((b) => b.runs.every((r) => r.text === ''))) return null;
  const concrete = concreteFont(props.font, theme);
  const base: FontSpec = { ...concrete, size: props.size ?? concrete.size, weight: concrete.weight ?? 400, style: concrete.style ?? 'normal' };
  const inner = { w: Math.max(0, box.w - 2 * box.padding), h: Math.max(0, box.h - 2 * box.padding) };
  const laid = layoutStyled(blocks, base, props.measurer, { maxWidth: inner.w, align: lit(props.font.align, theme) });
  const left = box.x + box.padding;
  const top = box.y + box.padding + (inner.h - laid.height) * (DOWN[lit(props.font.verticalAlign, theme)] ?? 0.5);
  const lines = laid.lines.filter((l) => l.text !== '');
  return (
    <text
      xmlSpace="preserve"
      textRendering="geometricPrecision"
      fontFamily={base.family}
      fontSize={n3(base.size)}
      fontWeight={base.weight}
      fontStyle={base.style}
      fill={lit(props.font.color, theme) || '#000000'}
      opacity={opacityOf(props.opacity, theme) === 1 ? undefined : opacityOf(props.opacity, theme)}
    >
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a label's lines have no identity but their order
        <tspan key={i} x={n3(left + line.x)} y={n3(top + line.baseline)}>
          {line.pieces.map((p, k) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces have no identity but their order
            <tspan key={k} x={n3(left + p.x)} {...fontAttrs(p.font, base)}>
              {p.text}
            </tspan>
          ))}
        </tspan>
      ))}
    </text>
  );
}
