// The browser TextMeasurer (FR-SHP-006, FR-TXT-002): a 2D canvas measures lines in the same font the
// DOM draws them with, cached per font and text; hosts await `ready()` (document.fonts) before relying
// on a measurement. Server rendering has no measurer (ADR-0018 item 4).
import { createMetricsMeasurer, type FaceMetrics, type FontSpec, type TextMeasurer, type TextMetrics } from '@fluxion/core';
import type { Theme } from '@fluxion/theme';
import { type Context, createContext, useSyncExternalStore } from 'react';
import { substitute } from './css-values.js';

/**
 * A text measurer backed by a canvas.
 *
 * @public
 */
export type CanvasTextMeasurer = TextMeasurer & {
  /** Resolves when the document's fonts have loaded (measurements before then use fallbacks). */
  ready(): Promise<void>;
};

/** The CSS `font` shorthand of `font`. */
const shorthand = (font: FontSpec) => `${font.style ?? 'normal'} ${font.weight ?? 400} ${font.size}px ${font.family}`;

/** Cached line widths at most: a long editing session re-measures rather than growing without bound. */
const CACHE_LIMIT = 10_000;

/**
 * A measurer drawing into a detached canvas, caching each line's width by font and text.
 *
 * @public
 */
export function createCanvasMeasurer(): CanvasTextMeasurer {
  const context = document.createElement('canvas').getContext('2d');
  // measure as the content layer draws (text-rendering: geometricPrecision): glyph advances unhinted, so the same on every platform (ADR-0148)
  if (context !== null && 'textRendering' in context) context.textRendering = 'geometricPrecision';
  const widths = new Map<string, number>();
  const width = (line: string, font: FontSpec): number => {
    const css = shorthand(font);
    const key = `${css}\u0000${line}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (context === null) return 0;
      context.font = css;
      w = context.measureText(line).width;
      if (widths.size >= CACHE_LIMIT) widths.clear();
      widths.set(key, w);
    }
    return w;
  };
  return {
    measure(text: string, font: FontSpec): TextMetrics {
      const lines = text.split('\n');
      return {
        width: Math.max(...lines.map((line) => width(line, font))),
        height: lines.length * (font.lineHeight ?? 1.2) * font.size,
        ascent: 0.8 * font.size,
        descent: 0.2 * font.size,
      };
    },
    ready: async () => {
      await document.fonts.ready;
      // widths taken with fallback fonts are stale once the real ones load
      widths.clear();
    },
  };
}

let shared: CanvasTextMeasurer | undefined;
/** The faces whose recorded metrics measure text as the DOM draws it (ADR-0148); any other font goes to the canvas. */
let recorded: readonly FaceMetrics[] = [];
/** How many times the page's fonts finished loading or metrics were registered: views measuring with the shared measurer re-render on it. */
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => {
  generation++;
  for (const listener of listeners) listener();
};

/** Every registration still in force, oldest first: `recorded` is these, a later record of a face replacing an earlier one. */
const registrations: (readonly FaceMetrics[])[] = [];

/** The key of a face: its family (without regard to case), weight and style. */
const keyOf = (f: FaceMetrics): string => `${f.family.toLowerCase()}|${f.weight}|${f.style}`;

/** `recorded` from the registrations in force: a face registered again replaces its earlier record, and gives it back when it is released. */
function rebuild(): void {
  const byFace = new Map<string, FaceMetrics>();
  for (const faces of registrations) for (const face of faces) byFace.set(keyOf(face), face);
  recorded = [...byFace.values()];
}

/**
 * Measure with the recorded metrics of `faces` from now on, for the fonts they cover (the page's shared measurer; ADR-0148, M9.14):
 * call it once the faces are loaded, since the metrics describe the real font and the page draws a fallback until it has loaded.
 * Views measuring with the shared measurer re-render. A face registered again (the same family, weight and style) replaces the earlier record while
 * it is in force. Returns the way to take exactly this registration out again (a host that loaded a document's fonts lets go of them when it closes
 * the document): the records it replaced come back, and a registration made since stays.
 *
 * @public
 */
export function registerFontMetrics(faces: readonly FaceMetrics[]): () => void {
  const registration = [...faces];
  registrations.push(registration);
  rebuild();
  notify();
  return () => {
    const at = registrations.indexOf(registration);
    if (at < 0) return;
    registrations.splice(at, 1);
    rebuild();
    notify();
  };
}

/**
 * The page's shared measurer, or none outside a browser: recorded metrics where there are some (`registerFontMetrics`), the canvas
 * otherwise. Its canvas cache is emptied whenever fonts finish loading.
 *
 * @public
 */
export function browserMeasurer(): CanvasTextMeasurer | undefined {
  if (typeof document === 'undefined') return undefined;
  if (shared === undefined) {
    const canvas = createCanvasMeasurer();
    let metrics: TextMeasurer | undefined;
    let built: readonly FaceMetrics[] | undefined;
    shared = {
      measure: (text, font) => {
        // rebuilt when faces were registered since
        if (metrics === undefined || built !== recorded) {
          metrics = createMetricsMeasurer(recorded, canvas);
          built = recorded;
        }
        return metrics.measure(text, font);
      },
      ready: canvas.ready,
    };
    // widths taken before a web font loaded are wrong once it has: measure again (M5.14 review F1)
    document.fonts.addEventListener('loadingdone', () => void canvas.ready().then(notify));
  }
  return shared;
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

/** A number that changes when the page's fonts finish loading (0 on a server), for views that measure text. */
export function useFontGeneration(): number {
  return useSyncExternalStore(
    subscribe,
    () => generation,
    () => 0,
  );
}

/** The host's measurer, provided by `<ScreenView>` (default: the page's canvas measurer). */
export const MeasurerContext: Context<TextMeasurer | undefined> = createContext<TextMeasurer | undefined>(undefined);

/**
 * The concrete font of a resolved style: its `var(--fx-…)` values replaced by `theme`'s, for measuring.
 */
export function concreteFont(
  font: { readonly family: string; readonly size: string; readonly weight: string; readonly lineHeight: string; readonly style: string },
  theme: Theme,
): FontSpec {
  const value = (css: string) => substitute(css, theme);
  const number = (css: string, fallback: number) => {
    const n = Number.parseFloat(value(css));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    family: value(font.family),
    size: number(font.size, 16),
    weight: number(font.weight, 400),
    lineHeight: number(font.lineHeight, 1.2),
    style: value(font.style) || 'normal',
  };
}
