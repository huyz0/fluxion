// Embedded fonts of an SVG export (ADR-0056 item 5, FR-EXP-004, `fonts: 'embed'`): each face the glyph inventory uses is cut to
// exactly the export's codepoints by the host's font job (format's runFontSubsetJob through its FontJobWorker, ADR-0051's limits)
// and written once in `<defs><style>` as an `@font-face` under a private alias, `fx-export-<sha256:12>` of the bytes embedded; text
// names the alias first, then its own family list. A face whose subset is refused, or a host with no job, embeds the whole verified
// file instead (`FLX_EXPORT_FONT_WHOLE`); a font with no face, or a file that is no font, stays its own family
// (`FLX_EXPORT_FONT_NOT_EMBEDDED`). No `node:*`, DOM or clock: the host lends the faces and the job.
import { type FontSpec, matchFace, sha256Hex } from '@fluxion/core';
import type { FontSubsetInput, FontSubsetOutcome } from '@fluxion/format';
import type { SvgDiagnostic } from '@fluxion/render/svg';
import type { GlyphRuns, SvgFontFace, SvgFontPorts } from './svg-fonts.js';
import { base64 } from './svg-package.js';

/** A font file's container by its first four bytes: its media type and CSS format, or undefined for anything that is no font. */
function containerOf(bytes: Uint8Array): { readonly mime: string; readonly format: string } | undefined {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'wOF2') return { mime: 'font/woff2', format: 'woff2' };
  if (magic === 'OTTO') return { mime: 'font/otf', format: 'opentype' };
  if (magic === 'true' || magic === '\u0000\u0001\u0000\u0000') return { mime: 'font/ttf', format: 'truetype' };
  return undefined;
}

/** The scalars of `text` and of its composed and decomposed forms (a shaper may compose or decompose), as the inventory takes them. */
function addScalars(out: Set<number>, text: string): void {
  for (const form of [text, text.normalize('NFC'), text.normalize('NFD')]) {
    for (const ch of form) {
      const cp = ch.codePointAt(0) as number;
      out.add(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
    }
  }
}

/** The `@font-face` rule of `bytes` under `alias`, with the face's own weight and style so no browser synthesizes them. */
function fontFace(alias: string, face: SvgFontFace, bytes: Uint8Array, container: { readonly mime: string; readonly format: string }): string {
  const src = `url(data:${container.mime};base64,${base64(bytes)}) format("${container.format}")`;
  return `@font-face{font-family:"${alias}";src:${src};font-weight:${face.weight};font-style:${face.style}}`;
}

/** What an embedding writes: the `<style>` rules and, per font, the family list its text names. */
export type Embedding = {
  /** The `@font-face` rules, one per face embedded, in the order the faces were first used. */
  readonly css: string;
  /** The family list to write for `font`: its face's alias first, then its own list; undefined for a font not embedded. */
  readonly family: (font: FontSpec) => string | undefined;
};

/** The bytes to embed for `face` cut to `codepoints`: the subset, or the whole file with why. */
async function cut(face: SvgFontFace, codepoints: readonly number[], ports: SvgFontPorts): Promise<{ readonly bytes: Uint8Array; readonly whole?: string }> {
  if (ports.subset === undefined) return { bytes: face.bytes, whole: 'no font job was lent' };
  const input: FontSubsetInput = {
    bytes: face.bytes,
    sourceSha256: sha256Hex(face.bytes),
    weight: face.weight,
    style: face.style,
    codepoints,
    ...(face.rights === undefined ? {} : { rights: face.rights }),
    ...(face.verifiedSource === undefined ? {} : { verifiedSource: face.verifiedSource }),
    ...(face.modificationPermission === undefined ? {} : { modificationPermission: face.modificationPermission }),
  };
  const outcome: FontSubsetOutcome = await ports.subset(input);
  return outcome.status === 'subset' ? { bytes: outcome.woff2 } : { bytes: face.bytes, whole: outcome.message };
}

/** The faces `runs` use with the codepoints each draws; a font with no face, or a face that is no font file, is reported. */
function usedFaces(runs: GlyphRuns, ports: SvgFontPorts, report: (diagnostic: SvgDiagnostic) => void): Map<SvgFontFace, Set<number>> {
  const used = new Map<SvgFontFace, Set<number>>();
  for (const { font, texts } of runs.values()) {
    const face = matchFace(ports.faces, font);
    if (face === undefined || containerOf(face.bytes) === undefined) {
      const why = face === undefined ? 'has no face with bytes' : 'has a face that is no font file';
      report({ code: 'FLX_EXPORT_FONT_NOT_EMBEDDED', message: `font ${JSON.stringify(font.family)} ${why}: its text names the family alone` });
      continue;
    }
    const codepoints = used.get(face) ?? new Set<number>();
    for (const text of texts) addScalars(codepoints, text);
    used.set(face, codepoints);
  }
  return used;
}

/**
 * The embedding of `runs` from `ports`' faces: each face cut to the codepoints its runs draw and written once. Reports a whole face
 * (`FLX_EXPORT_FONT_WHOLE`) and a font left to the viewer's fonts (`FLX_EXPORT_FONT_NOT_EMBEDDED`).
 */
export async function embedRuns(runs: GlyphRuns, ports: SvgFontPorts, report: (diagnostic: SvgDiagnostic) => void): Promise<Embedding> {
  const used = usedFaces(runs, ports, report);
  const aliases = new Map<SvgFontFace, string>();
  const rules: string[] = [];
  for (const [face, codepoints] of used) {
    const { bytes, whole } = await cut(
      face,
      [...codepoints].sort((a, b) => a - b),
      ports,
    );
    if (whole !== undefined)
      report({ code: 'FLX_EXPORT_FONT_WHOLE', message: `font ${JSON.stringify(face.family)} ${face.weight} ${face.style} is embedded whole: ${whole}` });
    const alias = `fx-export-${sha256Hex(bytes).slice(0, 12)}`;
    aliases.set(face, alias);
    rules.push(fontFace(alias, face, bytes, containerOf(bytes) ?? { mime: 'font/woff2', format: 'woff2' }));
  }
  return {
    css: rules.join(''),
    family: (font) => {
      const face = matchFace(ports.faces, font);
      const alias = face === undefined ? undefined : aliases.get(face);
      return alias === undefined ? undefined : `"${alias}", ${font.family}`;
    },
  };
}
