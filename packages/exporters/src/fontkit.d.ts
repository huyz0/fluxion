// The part of fontkit 2.0.4 the SVG export's outliner calls (ADR-0056 item 5); fontkit ships no types of its own.
declare module 'fontkit' {
  /** One drawing command of a glyph's outline, in font units with y up. */
  export type PathCommand = {
    readonly command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    readonly args: readonly number[];
  };
  /** A glyph and its outline. */
  export type Glyph = { readonly path: { readonly commands: readonly PathCommand[] } };
  /** Where shaping placed a glyph, in font units. */
  export type GlyphPosition = { readonly xAdvance: number; readonly yAdvance: number; readonly xOffset: number; readonly yOffset: number };
  /** A shaped run: its glyphs and their positions, index for index. */
  export type GlyphRun = { readonly glyphs: readonly Glyph[]; readonly positions: readonly GlyphPosition[] };
  /** An opened face. */
  export type Font = {
    readonly unitsPerEm: number;
    readonly underlinePosition: number;
    readonly underlineThickness: number;
    readonly 'OS/2'?: { readonly yStrikeoutPosition?: number; readonly yStrikeoutSize?: number };
    layout(text: string, features?: readonly string[]): GlyphRun;
  };
  /** Opens a face from its SFNT bytes (a collection yields no single font). */
  export function create(bytes: Uint8Array): Font | { readonly fonts: readonly Font[] };
}
