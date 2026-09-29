import type { RecordId, Style } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { toCssVars } from './resolve.js';
import { resolveBackground, resolveStyle } from './resolve-style.js';
import type { Theme } from './tokens.js';

const ROLES = ['primary', 'secondary', 'surface', 'text', 'muted', 'connector', 'accent-1', 'accent-6'];
const LITERALS = ['#123456', '#abc', 'rgb(10 20 30)', 'oklch(0.5 0.1 20)', 'rebeccapurple', 'white'];
const arbRef = fc.constantFrom(...ROLES).map((r) => `{color.${r}}` as const);
const arbLiteral = fc.constantFrom(...LITERALS);
const arbKind = fc.constantFrom('shape', 'connector', 'text', 'frame');

/** LIGHT_THEME with arbitrary token-ref defaults for `kind` and the globals. */
const themeWith = (kind: string, fill: string, stroke: string): Theme => ({
  ...LIGHT_THEME,
  defaults: { ...LIGHT_THEME.defaults, [kind]: { fill, stroke: { color: stroke, width: '{stroke.thick}' } }, '*': { fill, radius: '{radius.md}' } },
});

describe('resolved style (FR-THM-001, 02 §Style)', () => {
  it('FR-THM-001: a literal always beats a token', () => {
    fc.assert(
      fc.property(
        fc.record({ kind: arbKind, literal: arbLiteral, fillRef: arbRef, strokeRef: arbRef, width: fc.integer({ min: 0, max: 20 }) }),
        ({ kind, literal, fillRef, strokeRef, width }) => {
          const theme = themeWith(kind, fillRef, strokeRef);
          const style: Style = { fill: literal, stroke: { color: literal, width }, radius: width };
          const { style: r, diagnostics } = resolveStyle(style, kind, theme);
          expect(r.fill).toEqual({ type: 'color', css: literal });
          expect(r.stroke.color).toBe(literal);
          expect(r.stroke.width).toBe(`${width}px`);
          expect(r.radius).toBe(`${width}px`);
          expect(diagnostics).toEqual([]);
          // and a token on the element beats the theme's defaults
          const byRef = resolveStyle({ fill: fillRef }, kind, themeWith(kind, '{color.danger}', strokeRef)).style;
          expect(byRef.fill).toEqual({ type: 'color', css: expect.stringContaining(`var(--fx-color-${fillRef.slice(7, -1)}, `) });
        },
      ),
    );
  });

  it('FR-THM-001: an unknown token falls back with FLX_TOKEN_UNKNOWN', () => {
    const { style, diagnostics } = resolveStyle({ fill: '{color.nope}', stroke: { width: '{stroke.huge}' } }, 'shape', LIGHT_THEME, ['records', 'r1', 'style']);
    // the shape defaults of the theme take over, as CSS variables with the theme value as fallback
    expect(style.fill).toEqual({ type: 'color', css: 'var(--fx-color-surface, #f8fafc)' });
    expect(style.stroke.width).toBe('var(--fx-stroke-regular, 2px)');
    expect(diagnostics).toEqual([
      { code: 'FLX_TOKEN_UNKNOWN', severity: 'warning', path: '/records/r1/style/fill', message: 'theme light has no token {color.nope}' },
      { code: 'FLX_TOKEN_UNKNOWN', severity: 'warning', path: '/records/r1/style/stroke/width', message: 'theme light has no token {stroke.huge}' },
    ]);
    // an unknown token in the theme's own defaults is reported there and the next layer is used
    const theme: Theme = { ...LIGHT_THEME, defaults: { shape: { fill: '{color.gone}' }, '*': { fill: '#ff0000' } } };
    const r = resolveStyle(undefined, 'shape', theme);
    expect(r.style.fill).toEqual({ type: 'color', css: '#ff0000' });
    expect(r.diagnostics.map((d) => d.path)).toEqual(['/theme/defaults/shape/fill']);
  });

  it('layers: variant → kind defaults → globals → built-in fallbacks', () => {
    const theme: Theme = {
      name: 't',
      tokens: LIGHT_THEME.tokens,
      defaults: {
        shape: { fill: '#111111', variants: { emphasis: { fill: '{color.primary}' } } },
        '*': { opacity: 0.5, font: { family: '{font.body}', size: 14 } },
      },
    };
    expect(resolveStyle({ variant: 'emphasis' }, 'shape', theme).style.fill).toEqual({ type: 'color', css: 'var(--fx-color-primary, #2563eb)' });
    expect(resolveStyle({ variant: 'unknown' }, 'shape', theme).style.fill).toEqual({ type: 'color', css: '#111111' });
    // a definition's defaults sit under the element and its variant, over the theme's defaults (02 §2)
    const star = { kind: 'shape', defaults: { fill: '#ff0000', stroke: { width: 3 }, opacity: 0.25 } };
    expect(resolveStyle(undefined, star, theme).style).toMatchObject({ fill: { type: 'color', css: '#ff0000' }, opacity: '0.25' });
    expect(resolveStyle(undefined, star, theme).style.stroke.width).toBe('3px');
    expect(resolveStyle({ fill: '#00ff00' }, star, theme).style.fill).toEqual({ type: 'color', css: '#00ff00' });
    expect(resolveStyle({ variant: 'emphasis' }, star, theme).style.fill).toEqual({ type: 'color', css: 'var(--fx-color-primary, #2563eb)' });
    expect(resolveStyle(undefined, { kind: 'shape' }, theme).style.fill).toEqual({ type: 'color', css: '#111111' });
    // an unknown token in the defaults is reported where the definition keeps it, and skipped
    const odd = resolveStyle(undefined, { kind: 'shape', defaults: { fill: '{color.nope}' }, defaultsAt: ['shapeDefs', 'x:y', 'defaultStyle'] }, theme);
    expect(odd.style.fill).toEqual({ type: 'color', css: '#111111' });
    expect(odd.diagnostics.map((d) => d.path)).toEqual(['/shapeDefs/x:y/defaultStyle/fill']);
    expect(resolveStyle(undefined, { kind: 'shape', defaults: { fill: '{color.nope}' } }, theme).diagnostics[0]?.path).toBe('/definition/defaultStyle/fill');
    const plain = resolveStyle(undefined, 'shape', theme).style;
    expect(plain.opacity).toBe('0.5');
    expect(plain.font.family).toBe('var(--fx-font-body, "Inter", system-ui, sans-serif)');
    expect(plain.font.size).toBe('14px');
    // nothing anywhere: the built-in fallbacks
    const bare = resolveStyle(undefined, 'shape', { name: 'empty', tokens: {} }).style;
    expect(bare).toEqual({
      fill: { type: 'none' },
      stroke: { color: 'currentColor', width: '1px', cap: 'butt', join: 'miter' },
      opacity: '1',
      radius: '0px',
      font: {
        family: 'sans-serif',
        size: '16px',
        weight: '400',
        lineHeight: '1.2',
        color: 'currentColor',
        style: 'normal',
        align: 'center',
        verticalAlign: 'middle',
      },
    });
    // the light theme's own defaults
    const connector = resolveStyle(undefined, 'connector', LIGHT_THEME).style;
    expect(connector.stroke).toMatchObject({ color: 'var(--fx-color-connector, #334155)', width: 'var(--fx-stroke-regular, 2px)' });
  });

  it('paints: transformed tokens, gradients, images, none', () => {
    const lighter = resolveStyle({ fill: { token: '{color.primary}', transform: { lighten: 0.2, alpha: 0.5 } } }, 'shape', LIGHT_THEME).style.fill;
    expect(lighter).toEqual({ type: 'color', css: 'color-mix(in oklch, color-mix(in oklch, var(--fx-color-primary, #2563eb), white 20%) 50%, transparent)' });
    const darker = resolveStyle({ fill: { token: '{color.primary}', transform: { lighten: -0.3 } } }, 'shape', LIGHT_THEME).style.fill;
    expect(darker).toEqual({ type: 'color', css: 'color-mix(in oklch, var(--fx-color-primary, #2563eb), black 30%)' });
    const bad = resolveStyle({ fill: { token: '{color.nope}', transform: {} } }, 'shape', LIGHT_THEME);
    expect(bad.diagnostics.map((d) => d.path)).toEqual(['/style/fill/token']);
    const gradient = resolveStyle(
      {
        fill: {
          type: 'linear-gradient',
          angle: 90,
          stops: [
            { offset: 1, color: '{color.secondary}' },
            { offset: 0, color: '#000' },
            { offset: 0.5, color: '{color.none}' },
          ],
        },
      },
      'shape',
      LIGHT_THEME,
    );
    expect(gradient.style.fill).toEqual({
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { offset: 0, css: '#000' },
        { offset: 1, css: 'var(--fx-color-secondary, #7c3aed)' },
      ],
    });
    expect(gradient.diagnostics.map((d) => d.path)).toEqual(['/style/fill/stops/2/color']);
    const radial = resolveStyle(
      {
        fill: {
          type: 'radial-gradient',
          stops: [
            { offset: 0, color: '#fff' },
            { offset: 1, color: '#000' },
          ],
        },
      },
      'shape',
      LIGHT_THEME,
    ).style.fill;
    expect(radial).toMatchObject({ type: 'radial-gradient', angle: 0 });
    expect(resolveStyle({ fill: { type: 'image', assetId: 'a1' as RecordId } }, 'shape', LIGHT_THEME).style.fill).toEqual({
      type: 'image',
      assetId: 'a1',
      fit: 'cover',
    });
    expect(resolveStyle({ fill: { type: 'image', assetId: 'a1' as RecordId, fit: 'tile' } }, 'shape', LIGHT_THEME).style.fill).toMatchObject({ fit: 'tile' });
    expect(resolveStyle({ fill: 'transparent' }, 'shape', LIGHT_THEME).style.fill).toEqual({ type: 'none' });
  });

  it('stroke and font fields', () => {
    const r = resolveStyle(
      {
        stroke: { color: '#000', width: 3, dash: [4, 2], cap: 'round', join: 'bevel' },
        font: {
          family: 'Georgia',
          size: '{font.size.lg}',
          weight: '{font.weight.bold}',
          lineHeight: 1.5,
          color: '{color.text}',
          style: 'italic',
          align: 'left',
          verticalAlign: 'top',
        },
      },
      'text',
      LIGHT_THEME,
    ).style;
    expect(r.stroke).toEqual({ color: '#000', width: '3px', dash: '4 2', cap: 'round', join: 'bevel' });
    expect(r.font).toEqual({
      family: '"Georgia"',
      size: 'var(--fx-font-size-lg, 24px)',
      weight: 'var(--fx-font-weight-bold, 700)',
      lineHeight: '1.5',
      color: 'var(--fx-color-text, #0f172a)',
      style: 'italic',
      align: 'left',
      verticalAlign: 'top',
    });
    // a value of the wrong shape is skipped like an absent one
    const odd = resolveStyle({ radius: 'big' as never, stroke: { dash: ['x'] as never } }, 'shape', LIGHT_THEME).style;
    expect(odd.radius).toBe('var(--fx-radius-none, 0px)');
    expect(odd.stroke.dash).toBeUndefined();
  });

  it('no resolved value can carry other CSS, whatever the theme defaults hold (M4.10 review F2)', () => {
    const hostile: Theme = {
      name: 'h',
      tokens: LIGHT_THEME.tokens,
      defaults: {
        shape: {
          fill: 'red;background:url(https://x/beacon)',
          stroke: { color: 'red}', width: Number.NaN, cap: 'round;x:y', join: 'bevel', dash: [4, -1] },
          font: { family: 'x</style><script>', align: 'center;x:y', style: 'italic', color: 'expression(x)' },
        },
        '*': { fill: '#ffffff', stroke: { color: '#000', width: 1, cap: 'square' }, font: { family: 'Noto Sans 3' } },
      },
    };
    const r = resolveStyle(undefined, 'shape', hostile).style;
    // every hostile value is skipped and the next layer is used
    expect(r.fill).toEqual({ type: 'color', css: '#ffffff' });
    expect(r.stroke).toEqual({ color: '#000', width: '1px', cap: 'square', join: 'bevel' });
    // a literal family is one quoted, escaped name (a name with digits and spaces stays valid CSS)
    expect(r.font.family).toBe('"Noto Sans 3"');
    expect(r.font.align).toBe('center');
    expect(r.font.color).toBe('currentColor');
    expect(resolveStyle({ font: { family: 'A "B"' } }, 'text', LIGHT_THEME).style.font.family).toBe('"A \\"B\\""');
    expect(resolveStyle({ font: { family: 'serif' } }, 'text', LIGHT_THEME).style.font.family).toBe('serif');
  });

  it('a gradient left with fewer than two stops falls through to the next layer (M4.10 review F4)', () => {
    const r = resolveStyle(
      {
        fill: {
          type: 'linear-gradient',
          stops: [
            { offset: 0, color: '{color.x}' },
            { offset: 1, color: '#000' },
          ],
        },
      },
      'shape',
      LIGHT_THEME,
    );
    expect(r.style.fill).toEqual({ type: 'color', css: 'var(--fx-color-surface, #f8fafc)' });
    expect(r.diagnostics.map((d) => d.path)).toEqual(['/style/fill/stops/0/color']);
  });

  it('a theme object that was never parsed cannot inject CSS through tokens (M4.10 review round 2 F1)', () => {
    const unparsed = {
      name: 'u',
      tokens: {
        color: { x: { $type: 'color', $value: 'red);}body{background:url(//x/beacon)' }, ok: { $type: 'color', $value: '#010203' } },
        'a);x:y': { $type: 'number', $value: 1 },
      },
      defaults: { shape: { fill: '{color.x}', opacity: '{a);x:y}' }, '*': { fill: '{color.ok}' } },
    } as unknown as Theme;
    const r = resolveStyle(undefined, 'shape', unparsed);
    // the invalid token is reported and skipped; the malformed reference is not a reference at all
    expect(r.style.fill).toEqual({ type: 'color', css: 'var(--fx-color-ok, #010203)' });
    expect(r.style.opacity).toBe('1');
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ code: 'FLX_TOKEN_UNKNOWN', path: '/theme/defaults/shape/fill', message: 'token {color.x} of theme u is not a valid token' }),
    ]);
    // and toCssVars leaves such tokens out
    expect(toCssVars(unparsed)).toEqual({ '--fx-color-ok': '#010203' });
  });

  it('non-finite transform numbers and stop offsets are not emitted (M4.10 review round 2 F2, F3)', () => {
    const nan = resolveStyle({ fill: { token: '{color.primary}', transform: { lighten: Number.NaN, alpha: Number.POSITIVE_INFINITY } } }, 'shape', LIGHT_THEME);
    expect(nan.style.fill).toEqual({ type: 'color', css: 'var(--fx-color-primary, #2563eb)' });
    const clamped = resolveStyle({ fill: { token: '{color.primary}', transform: { lighten: 5, alpha: -1 } } }, 'shape', LIGHT_THEME).style.fill;
    expect(clamped).toEqual({ type: 'color', css: 'color-mix(in oklch, color-mix(in oklch, var(--fx-color-primary, #2563eb), white 100%) 0%, transparent)' });
    const stops = resolveStyle(
      {
        fill: {
          type: 'linear-gradient',
          stops: [
            { offset: Number.NaN, color: '#111' },
            { offset: 2, color: '#222' },
            { offset: -1, color: '#333' },
          ],
        },
      },
      'shape',
      LIGHT_THEME,
    ).style.fill;
    expect(stops).toEqual({
      type: 'linear-gradient',
      angle: 0,
      stops: [
        { offset: 0, css: '#333' },
        { offset: 1, css: '#222' },
      ],
    });
  });

  it('FR-SCR-001: a screen background resolves its own paint, then the theme screen default', () => {
    expect(resolveBackground(undefined, LIGHT_THEME).paint).toEqual({ type: 'color', css: 'var(--fx-color-background, #ffffff)' });
    expect(resolveBackground('#102030', LIGHT_THEME).paint).toEqual({ type: 'color', css: '#102030' });
    expect(resolveBackground('{color.primary}', LIGHT_THEME).paint).toEqual({ type: 'color', css: 'var(--fx-color-primary, #2563eb)' });
    const g = resolveBackground(
      {
        type: 'radial-gradient',
        stops: [
          { offset: 0, color: '#fff' },
          { offset: 1, color: '{color.surface}' },
        ],
      },
      LIGHT_THEME,
    ).paint;
    expect(g).toEqual({
      type: 'radial-gradient',
      angle: 0,
      stops: [
        { offset: 0, css: '#fff' },
        { offset: 1, css: 'var(--fx-color-surface, #f8fafc)' },
      ],
    });
    expect(resolveBackground({ type: 'image', assetId: 'a1' as RecordId, fit: 'contain' }, LIGHT_THEME).paint).toEqual({
      type: 'image',
      assetId: 'a1',
      fit: 'contain',
    });
    const bad = resolveBackground('{color.gone}', LIGHT_THEME, ['records', 's1']);
    expect(bad.paint).toEqual({ type: 'color', css: 'var(--fx-color-background, #ffffff)' });
    expect(bad.diagnostics.map((d) => [d.code, d.path])).toEqual([['FLX_TOKEN_UNKNOWN', '/records/s1/background']]);
    // no screen default anywhere: no background
    expect(resolveBackground(undefined, { name: 'e', tokens: {} }).paint).toEqual({ type: 'none' });
  });
});
