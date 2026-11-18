// The pack-view contract of the svg surface (ADR-0056 item 4, FR-EXP-004, FR-EXT-001): a pack's `ElementView.Svg` asks the export
// for its text through `useExportText` and gets the measured line layout the built-in labels get (item 3), laid out with the host's
// measurer and recorded in the export's glyph inventory. Packs reach it through `@fluxion/sdk/export`, which keeps render external,
// so every pack reads the host's one `ExportContext`.
import { type FontSpec, type LaidOutLine, type LaidOutPiece, layoutStyled, type TextMeasurer } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import { LIGHT_THEME, type ResolvedStyle, type Theme } from '@fluxion/theme';
import { type ComponentType, type Context, useContext } from 'react';
import type { ElementViewProps } from './registries.js';
import { richBlocks } from './rich-layout.js';
import type { MarkPlan } from './rich-marks.js';
import { lit } from './svg-paint.js';
import { SvgSurface, type SvgSurfaceContext, type TextOutline, useSvgMeasurer } from './svg-surface.js';
import { highlight, markPaint, outbound, plansOf } from './svg-text.js';
import { concreteFont } from './text-measurer.js';

/**
 * The svg leaf of an element view (`ElementView['Svg']`): SVG 1.1 in the box's own coordinates, colours as literals.
 *
 * @public
 */
export type Svg = ComponentType<ElementViewProps>;

/**
 * The export's context as a pack view reads it: the host's one instance (the svg surface's), so a pack built against
 * `@fluxion/sdk/export` measures with the host's measurer and records its glyphs in the host's inventory.
 *
 * @public
 */
export const ExportContext: Context<SvgSurfaceContext> = SvgSurface;

/**
 * What a piece's marks draw, in literals: underline and strike, its colour (a colour mark, or the link colour inside a link), its
 * highlight behind it, and the link it follows out of the file (http, https or mailto; an in-document screen link has none).
 *
 * @public
 */
export type ExportMarks = {
  /** Underlined (an underline mark or a link). */
  readonly underline: boolean;
  /** Struck through. */
  readonly strike: boolean;
  /** Its own colour, a literal; undefined keeps the text's. */
  readonly color?: string;
  /** The highlight colour behind it, a literal. */
  readonly highlight?: string;
  /** The outbound link it draws inside (`<a xlink:href>`). */
  readonly href?: string;
};

/**
 * A piece of an exported line: layoutStyled's piece with its marks, and its glyph outline when the export outlines its font.
 *
 * @public
 */
export type ExportPiece = LaidOutPiece & {
  /** What its marks draw. */
  readonly marks: ExportMarks;
  /** Its glyphs as a path (pen at its `x` on the line's baseline), when the export outlines them; else draw it as `<tspan>`. */
  readonly outline?: TextOutline;
};

/**
 * A line of exported text: layoutStyled's line whose pieces carry their marks and outlines.
 *
 * @public
 */
export type ExportLine = Omit<LaidOutLine, 'pieces'> & {
  /** The pieces, in order. */
  readonly pieces: readonly ExportPiece[];
};

/**
 * Text laid out for the svg surface: its lines (pieces in their fonts, x from the box's left, baselines from `top`), the text's font
 * and colour as literals, and where it starts in the box for its vertical alignment.
 *
 * @public
 */
export type ExportText = {
  /** The lines, in order; a piece's `x` is px from the box's left, a line's `baseline` px from `top`; each piece has its marks. */
  readonly lines: readonly ExportLine[];
  /** The text's own font, as literals (a piece in another font carries its own). */
  readonly font: FontSpec;
  /** The text colour, a literal. */
  readonly color: string;
  /** The text's top in the box, px: the free height times the vertical alignment (top 0, middle half, bottom all). */
  readonly top: number;
  /** The widest line, px. */
  readonly width: number;
  /** The height of all the lines, px. */
  readonly height: number;
};

/** How far down the free height text sits for a vertical alignment. */
const DOWN: { readonly [align: string]: number } = { top: 0, middle: 0.5, bottom: 1 };

/** Plain text as a document: a paragraph per line. */
const docOf = (text: string): RichTextDoc =>
  ({
    type: 'doc',
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line === '' ? [] : [{ type: 'text', text: line }] })),
  }) as RichTextDoc;

/** A piece's marks as {@link ExportMarks}, as the built-in labels draw them. */
function marksOf(plans: readonly MarkPlan[], theme: Theme): ExportMarks {
  const { underline, strike, fill } = markPaint(plans, theme);
  const behind = highlight(plans, theme);
  const href = outbound(plans);
  return {
    underline,
    strike,
    ...(fill === '' ? {} : { color: fill }),
    ...(behind === undefined ? {} : { highlight: behind }),
    ...(href === undefined ? {} : { href }),
  };
}

/**
 * `text` in `style`'s font laid out in `box` with the export's measurer, as the built-in labels are (ADR-0056 items 3 and 4); each
 * piece's glyphs are recorded in the export's inventory, and each carries its marks and, when the export outlines its font, its
 * outline (M20.13). Pure for one export: the same arguments give the same layout.
 *
 * @public
 */
export function useExportText(text: RichTextDoc | string, style: ResolvedStyle, box: { readonly w: number; readonly h: number }): ExportText {
  const context = useContext(ExportContext);
  const measurer: TextMeasurer = useSvgMeasurer();
  const theme = context.theme ?? LIGHT_THEME;
  const concrete = concreteFont(style.font, theme);
  const font: FontSpec = { ...concrete, weight: concrete.weight ?? 400, style: concrete.style ?? 'normal' };
  const { blocks, paints } = richBlocks(typeof text === 'string' ? docOf(text) : text, theme);
  const laid = layoutStyled(blocks, font, measurer, { maxWidth: Math.max(0, box.w), align: lit(style.font.align, theme) });
  const lines = laid.lines.map((line) => ({
    ...line,
    pieces: line.pieces.map((piece): ExportPiece => {
      context.glyphs?.(piece.font, piece.text);
      const outline = context.outline?.(piece.font, piece.text);
      return { ...piece, marks: marksOf(plansOf(paints, line, piece), theme), ...(outline === undefined ? {} : { outline }) };
    }),
  }));
  const top = (box.h - laid.height) * (DOWN[lit(style.font.verticalAlign, theme)] ?? 0.5);
  return { lines, font, color: lit(style.font.color, theme) || '#000000', top, width: laid.width, height: laid.height };
}
