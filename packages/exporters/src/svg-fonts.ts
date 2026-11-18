// Fonts of an SVG export (ADR-0056 items 2b and 5, FR-EXP-004): the glyph inventory a first render records (each piece's text in its
// font) is outlined here, between the render that gathers it and the render that draws it. Each font is matched to the host's faces
// as the measurer matched it (core's matchFace); its file is read as an SFNT through the pinned WOFF2 codec (format's fontSfnt, never
// fontkit's own Brotli path); fontkit, loaded with a dynamic import when an export first needs it, shapes each run (kern, liga) into
// one path in px, the pen at the origin on the baseline. A font with no face, or a face whose file cannot be read, stays `<text>`
// naming its family and is reported once. No `node:*`, DOM or clock: the host lends the faces and the codec.
import { type FontSpec, matchFace } from '@fluxion/core';
import { type FontSubsetInput, type FontSubsetOutcome, fontSfnt, type Woff2CodecExports } from '@fluxion/format';
import type { SvgDiagnostic, TextOutline } from '@fluxion/render/svg';
import type { Font, GlyphRun, PathCommand } from 'fontkit';

/**
 * A face an export may outline: the family, weight and style the measurer knows it by, and its file (WOFF2, TrueType or OpenType).
 *
 * @public
 */
export type SvgFontFace = {
  /** The family as CSS writes it unquoted (`Inter`); matched without regard to case. */
  readonly family: string;
  /** CSS weight. */
  readonly weight: number;
  /** CSS style. */
  readonly style: 'normal' | 'italic';
  /** The font file's bytes. */
  readonly bytes: Uint8Array;
  /** Its recorded licence and copyright text, for the subset job (a Reserved Font Name keeps it whole). */
  readonly rights?: string;
  /** The host verified its source and licence (a catalog font); an unverified face is embedded whole. */
  readonly verifiedSource?: boolean;
  /** Recorded permission to modify it, overriding an unverified source and a Reserved Font Name. */
  readonly modificationPermission?: boolean;
};

/**
 * What outlining borrows from the host: the faces it knows (the bundled fonts and the document's own) and the pinned WOFF2 codec.
 *
 * @public
 */
export type SvgFontPorts = {
  /** The faces, the document's own first (as the measurer orders them, so the same face wins). */
  readonly faces: readonly SvgFontFace[];
  /** A WOFF2 codec instance (format's `instantiateFontEngines(…).codec`), asked for once an export has a face to read. */
  readonly codec: () => Promise<Woff2CodecExports>;
  /**
   * Runs one font subset job (`fonts: 'embed'`): format's `runFontSubsetJob` through the host's `FontJobWorker`, under ADR-0051's
   * limits; without it every embedded face is whole.
   */
  readonly subset?: (input: FontSubsetInput) => Promise<FontSubsetOutcome>;
};

/** The texts each font of an export draws, as its first render recorded them. */
export type GlyphRuns = Map<string, { readonly font: FontSpec; readonly texts: Set<string> }>;

/** The key of `font` in an inventory: what picks its face and scales its outline. */
export const fontKey = (font: FontSpec): string => `${font.family}\u0000${font.weight ?? 400}\u0000${font.style ?? 'normal'}\u0000${font.size}`;

/** A collector for `GlyphRuns`: the svg surface's `glyphs` receiver. */
export function glyphCollector(): { readonly runs: GlyphRuns; readonly glyphs: (font: FontSpec, text: string) => void } {
  const runs: GlyphRuns = new Map();
  return {
    runs,
    glyphs: (font, text) => {
      if (text === '') return;
      const key = fontKey(font);
      const entry = runs.get(key) ?? { font, texts: new Set<string>() };
      entry.texts.add(text);
      runs.set(key, entry);
    },
  };
}

/** `v` with three decimals at most, and no negative zero. */
const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

const LETTER: { readonly [command in PathCommand['command']]: string } = {
  moveTo: 'M',
  lineTo: 'L',
  quadraticCurveTo: 'Q',
  bezierCurveTo: 'C',
  closePath: 'Z',
};

/** The path of `run` in px at `scale` (px per font unit), the pen starting at the origin on the baseline, y down. */
function runPath(run: GlyphRun, scale: number): string {
  const parts: string[] = [];
  let pen = 0;
  run.glyphs.forEach((glyph, i) => {
    const at = run.positions[i] ?? { xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 };
    const [ox, oy] = [pen + at.xOffset, at.yOffset];
    for (const c of glyph.path.commands) {
      const points: string[] = [];
      for (let k = 0; k + 1 < c.args.length; k += 2)
        points.push(`${num((ox + (c.args[k] as number)) * scale)} ${num(-(oy + (c.args[k + 1] as number)) * scale)}`);
      parts.push(points.length === 0 ? LETTER[c.command] : `${LETTER[c.command]}${points.join(' ')}`);
    }
    pen += at.xAdvance;
  });
  return parts.join('');
}

/** `text` in `font` at `size` px as an outline with the face's underline and strike, px below the baseline. */
function outlineOf(font: Font, text: string, size: number): TextOutline {
  const scale = size / font.unitsPerEm;
  const os2 = font['OS/2'];
  const strikeSize = os2?.yStrikeoutSize ?? font.underlineThickness;
  return {
    d: runPath(font.layout(text, ['kern', 'liga']), scale),
    underline: { y: -font.underlinePosition * scale, thickness: font.underlineThickness * scale },
    strike: { y: -(os2?.yStrikeoutPosition ?? font.unitsPerEm * 0.3) * scale, thickness: strikeSize * scale },
  };
}

/** The face `bytes` open as one font, or undefined when they do not (not a font, a collection, a damaged table). */
function opened(fontkit: typeof import('fontkit'), sfnt: Uint8Array): Font | undefined {
  try {
    const font = fontkit.create(sfnt);
    return 'layout' in font ? font : undefined;
  } catch {
    return undefined;
  }
}

/** `ports`' faces opened once each, on first use: fontkit and the codec are loaded only then. */
function faceOpener(ports: SvgFontPorts): (face: SvgFontFace) => Promise<Font | undefined> {
  const opened_ = new Map<SvgFontFace, Font | undefined>();
  let tools: { readonly fontkit: typeof import('fontkit'); readonly codec: Woff2CodecExports } | undefined;
  return async (face) => {
    if (!opened_.has(face)) {
      tools ??= { fontkit: await import('fontkit'), codec: await ports.codec() };
      const sfnt = fontSfnt(tools.codec, face.bytes);
      opened_.set(face, sfnt === undefined ? undefined : opened(tools.fontkit, sfnt));
    }
    return opened_.get(face);
  };
}

/**
 * The outlines of `runs` from `ports`' faces: a lookup for the render that draws them. A font no face matches, or whose face cannot be
 * read or fails while a run is shaped (fontkit reads tables lazily), is reported (`FLX_EXPORT_FONT_NOT_EMBEDDED`, once per family
 * list) and has no outline, so it stays `<text>`; a face that fails is dropped with every outline it gave.
 */
export async function outlineRuns(
  runs: GlyphRuns,
  ports: SvgFontPorts,
  report: (diagnostic: SvgDiagnostic) => void,
): Promise<(font: FontSpec, text: string) => TextOutline | undefined> {
  const open = faceOpener(ports);
  const byFace: FaceOutlines = new Map();
  const missing = (family: string, why: string) =>
    report({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: `font ${JSON.stringify(family)} ${why}: its text stays <text> naming the family` });
  for (const [key, run] of runs) {
    const face = matchFace(ports.faces, run.font);
    const why = face === undefined ? 'has no face with bytes' : await addRun({ byFace, open }, face, key, run);
    if (why !== undefined) missing(run.font.family, why);
  }
  const all = new Map([...byFace.values()].flatMap((m) => [...(m ?? [])]));
  return (font, text) => all.get(`${fontKey(font)}\u0000${text}`);
}

/** Faces by the outlines they gave, undefined for a face that could not be read. */
type FaceOutlines = Map<SvgFontFace, Map<string, TextOutline> | undefined>;

/** `run`'s outlines from `face` added to `byFace` under `key`; why it has none, when the face cannot be read or fails while shaping. */
async function addRun(
  faces: { readonly byFace: FaceOutlines; readonly open: (face: SvgFontFace) => Promise<Font | undefined> },
  face: SvgFontFace,
  key: string,
  run: { readonly font: FontSpec; readonly texts: ReadonlySet<string> },
): Promise<string | undefined> {
  const { byFace, open } = faces;
  const outlines = byFace.has(face) ? byFace.get(face) : new Map<string, TextOutline>();
  const font = outlines === undefined ? undefined : await open(face);
  const shaped = font === undefined ? undefined : shapedRuns(font, run.font, run.texts);
  if (outlines === undefined || shaped === undefined) {
    // a face that fails is dropped with every outline it gave
    byFace.set(face, undefined);
    return 'has a face that cannot be read';
  }
  for (const [text, outline] of shaped) outlines.set(`${key}\u0000${text}`, outline);
  byFace.set(face, outlines);
  return undefined;
}

/** Each of `texts` in `font` outlined from `open`, or undefined when the face fails while shaping one (a damaged table). */
function shapedRuns(open: Font, font: FontSpec, texts: ReadonlySet<string>): Map<string, TextOutline> | undefined {
  const out = new Map<string, TextOutline>();
  try {
    for (const text of texts) out.set(text, outlineOf(open, text, font.size));
  } catch {
    return undefined;
  }
  return out;
}
