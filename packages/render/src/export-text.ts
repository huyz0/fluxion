// The pack-view contract of the svg surface (ADR-0056 item 4, FR-EXP-004, FR-EXT-001): a pack's `ElementView.Svg` asks the export
// for its text through `useExportText` and gets the measured line layout the built-in labels get (item 3), laid out with the host's
// measurer and recorded in the export's glyph inventory. Packs reach it through `@fluxion/sdk/export`, which keeps render external,
// so every pack reads the host's one `ExportContext`.
import { type FontSpec, type LaidOutLine, layoutStyled, type TextMeasurer } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import { LIGHT_THEME, type ResolvedStyle } from '@fluxion/theme';
import { type ComponentType, type Context, useContext } from 'react';
import type { ElementViewProps } from './registries.js';
import { richBlocks } from './rich-layout.js';
import { lit } from './svg-paint.js';
import { SvgSurface, type SvgSurfaceContext, useSvgMeasurer } from './svg-surface.js';
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
 * Text laid out for the svg surface: its lines (pieces in their fonts, x from the box's left, baselines from `top`), the text's font
 * and colour as literals, and where it starts in the box for its vertical alignment.
 *
 * @public
 */
export type ExportText = {
  /** The lines, in order; a piece's `x` is px from the box's left, a line's `baseline` px from `top`. */
  readonly lines: readonly LaidOutLine[];
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

/**
 * `text` in `style`'s font laid out in `box` with the export's measurer, as the built-in labels are (ADR-0056 items 3 and 4); each
 * piece's glyphs are recorded in the export's inventory. Pure for one export: the same arguments give the same layout.
 *
 * @public
 */
export function useExportText(text: RichTextDoc | string, style: ResolvedStyle, box: { readonly w: number; readonly h: number }): ExportText {
  const context = useContext(ExportContext);
  const measurer: TextMeasurer = useSvgMeasurer();
  const theme = context.theme ?? LIGHT_THEME;
  const concrete = concreteFont(style.font, theme);
  const font: FontSpec = { ...concrete, weight: concrete.weight ?? 400, style: concrete.style ?? 'normal' };
  const { blocks } = richBlocks(typeof text === 'string' ? docOf(text) : text, theme);
  const laid = layoutStyled(blocks, font, measurer, { maxWidth: Math.max(0, box.w), align: lit(style.font.align, theme) });
  for (const line of laid.lines) for (const piece of line.pieces) context.glyphs?.(piece.font, piece.text);
  const top = (box.h - laid.height) * (DOWN[lit(style.font.verticalAlign, theme)] ?? 0.5);
  return { lines: laid.lines, font, color: lit(style.font.color, theme) || '#000000', top, width: laid.width, height: laid.height };
}
