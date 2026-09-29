// The browser TextMeasurer (FR-SHP-006, FR-TXT-002): a 2D canvas measures lines in the same font the
// DOM draws them with, cached per font and text; hosts await `ready()` (document.fonts) before relying
// on a measurement. Server rendering has no measurer (ADR-0018 item 4).
import type { FontSpec, TextMeasurer, TextMetrics } from '@fluxion/core';
import type { Theme } from '@fluxion/theme';
import { toCssVars } from '@fluxion/theme';
import { type Context, createContext, useSyncExternalStore } from 'react';

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
/** How many times the page's fonts finished loading: views measuring with the shared measurer re-render on it. */
let generation = 0;
const listeners = new Set<() => void>();

/** The page's shared canvas measurer, or none outside a browser. Its cache is emptied whenever fonts finish loading. */
export function browserMeasurer(): CanvasTextMeasurer | undefined {
  if (typeof document === 'undefined') return undefined;
  if (shared === undefined) {
    const measurer = createCanvasMeasurer();
    shared = measurer;
    // widths taken before a web font loaded are wrong once it has: measure again (M5.14 review F1)
    document.fonts.addEventListener('loadingdone', () => {
      void measurer.ready().then(() => {
        generation++;
        for (const notify of listeners) notify();
      });
    });
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

/** `css` with its `var(--fx-…)` references replaced by `theme`'s values (unknown ones by nothing). */
function substitute(css: string, theme: Theme): string {
  const vars = toCssVars(theme) as { readonly [name: string]: string | undefined };
  return css.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars[name] ?? '');
}

/**
 * A resolved length (`4px`, `var(--fx-radius-md)`) as a number of px with `theme`'s values; 0 when it
 * is none.
 */
export function concreteLength(css: string, theme: Theme): number {
  const n = Number.parseFloat(substitute(css, theme));
  return Number.isFinite(n) ? n : 0;
}

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
