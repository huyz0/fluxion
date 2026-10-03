// Public entry of @fluxion/pack-fonts-core; the package comment is the dts banner in tsdown.config.ts.
import { type FaceMetrics, type FontFaceDef, readFontMetrics } from '@fluxion/sdk';
import { MANIFEST } from './manifest.js';
import { METRICS_JSON } from './metrics.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The bundled faces (FR-THM-008, ADR-0022): Inter, Source Serif 4 and JetBrains Mono, Latin, weights 400 and 700, upright and
 * italic, all OFL-1.1. `file` is relative to this package; {@link fontUrl} gives the URL a bundler or a host serves it at.
 *
 * @public
 */
export const FONTS_CORE: readonly FontFaceDef[] = MANIFEST.map((f) => ({
  family: f.family,
  weight: f.weight,
  style: f.style,
  source: 'bundled' as const,
  file: f.file,
  license: f.license,
  copyright: f.copyright,
}));

/**
 * The URL of a bundled face's file under `base`, the URL the host serves this package's folder at (a bundler's asset URLs, a CDN
 * path, or `new URL('../', import.meta.url)` from `dist/` when the package is served as published).
 *
 * @public
 */
export function fontUrl(face: FontFaceDef, base: string | URL): string {
  // a bundled face always has a file (the registry refuses one with neither a file nor an asset)
  return new URL(face.file as string, base).href;
}

/**
 * The recorded metrics of the bundled faces (ADR-0148): what a measurer adds up to measure text in them as the DOM draws it, so a
 * host that has loaded the faces measures to within a pixel without a canvas. Recorded by `scripts/fonts/record-metrics.mjs --bundled`.
 *
 * @public
 */
export const FONT_METRICS: readonly FaceMetrics[] = readFontMetrics(JSON.parse(METRICS_JSON)).faces;
