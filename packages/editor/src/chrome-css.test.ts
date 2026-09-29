import { describe, expect, it } from 'vitest';
import { CANVAS_PATH, CHROME_CSS } from './chrome-css.js';

type Rule = { readonly selectors: readonly string[]; readonly properties: readonly string[] };

/** The style rules of `css` (at-rule wrappers such as `@layer` and `@media` are skipped). */
function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? '').split(',').map((s) => s.trim()),
    properties: (m[2] ?? '')
      .split(';')
      .map((d) => d.split(':')[0]?.trim() ?? '')
      .filter((p) => p !== ''),
  }));
}

/** The last compound of `selector`: what the rule actually styles. */
const lastCompound = (selector: string) =>
  selector
    .split(/[\s>+~]+/)
    .filter((c) => c !== '')
    .at(-1) ?? '';

const classesOf = (compound: string) => [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? '');

const isChromeClass = (c: string) => c === 'fx-editor' || c.startsWith('fx-chrome-');

// inherited CSS and SVG presentation properties (`color` also covers `color-scheme`); custom
// properties (`--ui-*`) inherit too, but no content rule reads them
const INHERITED =
  /^(color|font|text-|letter-spacing|word-|line-height|white-space|direction|visibility|cursor|-webkit-font|-moz-osx|list-style|quotes|tab-size|hyphens|writing-mode|overflow-wrap|caret|pointer-events|accent-color|fill|stroke|paint-order|marker|dominant-baseline|shape-rendering|image-rendering|clip-rule)/;

/** The selectors of `css` whose last compound names no chrome class. */
function unscoped(css: string): string[] {
  return rulesOf(css).flatMap((r) => r.selectors.filter((s) => !classesOf(lastCompound(s)).some(isChromeClass)));
}

/** `selector property` for each inherited property a rule of `css` sets on the canvas or its ancestors. */
function inheritedOnCanvasPath(css: string): string[] {
  return rulesOf(css).flatMap((r) =>
    r.selectors
      .filter((s) => classesOf(lastCompound(s)).some((c) => CANVAS_PATH.includes(c)))
      .flatMap((s) => r.properties.filter((p) => INHERITED.test(p)).map((p) => `${s} ${p}`)),
  );
}

describe('CHROME_CSS (ADR-0029)', () => {
  it('FR-EDT-010: every selector styles a chrome class, so no rule matches content', () => {
    expect(rulesOf(CHROME_CSS).length).toBe((CHROME_CSS.match(/\{/g) ?? []).length - 2);
    expect(unscoped(CHROME_CSS)).toEqual([]);
  });

  it('FR-EDT-010: the canvas and its ancestors set no inherited property', () => {
    // the path is the chrome's own classes, each laid out by a rule (the browser test matches it to the DOM)
    const styled = new Set(rulesOf(CHROME_CSS).flatMap((r) => r.selectors.flatMap((s) => classesOf(lastCompound(s)))));
    expect(CANVAS_PATH.length).toBe(4);
    expect(CANVAS_PATH.filter((c) => !styled.has(c))).toEqual([]);
    expect(inheritedOnCanvasPath(CHROME_CSS)).toEqual([]);
  });

  it('FR-EDT-010: the checks catch a rule that reaches content or leaks an inherited property', () => {
    expect(unscoped('.fx-editor svg { fill: red; } .fx-chrome-panel > p, .fx-chrome-tab { margin: 0; } [role=tab] { x: 1; }')).toEqual([
      '.fx-editor svg',
      '.fx-chrome-panel > p',
      '[role=tab]',
    ]);
    expect(
      inheritedOnCanvasPath(
        '.fx-editor { --ui-x: 1; font: 13px serif; } .x .fx-chrome-canvas { color: red; background: blue; } .fx-chrome-panel { color: red; }',
      ),
    ).toEqual(['.fx-editor font', '.x .fx-chrome-canvas color']);
    expect(inheritedOnCanvasPath('.fx-chrome-canvas { fill: red; stroke-width: 2; text-anchor: end; } .fx-editor { color-scheme: dark; }')).toEqual([
      '.fx-chrome-canvas fill',
      '.fx-chrome-canvas stroke-width',
      '.fx-chrome-canvas text-anchor',
      '.fx-editor color-scheme',
    ]);
  });

  it('FR-EDT-001: the chrome has light and dark colours, in its own layer', () => {
    expect(CHROME_CSS.startsWith('@layer fx.chrome {')).toBe(true);
    expect(CHROME_CSS).toMatch(/@media \(prefers-color-scheme: dark\) \{\n\.fx-editor \{ --ui-bg:/);
  });
});
