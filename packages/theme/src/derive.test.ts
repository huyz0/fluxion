import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { colorResolver, followColor } from './alias.js';
import { LIGHT_THEME } from './light.js';
import { deriveOklch, type Oklch, oklchToCss, parseColor, rgbToOklch } from './oklch.js';
import { toCssVars } from './resolve.js';
import { resolveStyle } from './resolve-style.js';
import { styleKey } from './style-key.js';
import { type Theme, type TokenGroup, themeSchema } from './tokens.js';
import { themeDiagnostics, validateTheme } from './validate-theme.js';

const EPS = 1e-3;
const near = (got: Oklch, want: readonly [number, number, number]) => {
  expect(got.l).toBeCloseTo(want[0], 3);
  expect(got.c).toBeCloseTo(want[1], 3);
  // the hue of a grey is powerless: only compared when there is chroma
  if (want[1] > 0.01) expect(Math.abs(((got.h - want[2] + 540) % 360) - 180)).toBeLessThan(EPS * 10);
};
const base = (css: string): Oklch => parseColor(css) as Oklch;

const color = ($value: string, transform?: unknown) => ({
  $type: 'color' as const,
  $value,
  ...(transform === undefined ? {} : { $extensions: { 'dev.fluxion': { transform } } }),
});
const withColors = (change: (c: { [k: string]: unknown }) => void, over: Partial<Theme> = {}): Theme => {
  const c = { ...(LIGHT_THEME.tokens['color'] as { [k: string]: unknown }) };
  change(c);
  return { ...LIGHT_THEME, ...over, tokens: { ...LIGHT_THEME.tokens, color: c as TokenGroup } };
};

describe('derived colours (FR-THM-002, ADR-0152)', () => {
  // reference values from an independent implementation of the OKLab definition (Ottosson), 6 places
  it('FR-THM-002: a derived token lightened by 20 percent in OKLCH matches the reference values within 1e-3', () => {
    const primary = base('#2563eb');
    near(primary, [0.54615, 0.215208, 262.880917]);
    near(deriveOklch(primary, [{ lighten: 0.2 }]), [0.63692, 0.172166, 262.880917]);
    near(deriveOklch(primary, [{ darken: 0.2 }]), [0.43692, 0.172166, 262.880917]);
    near(deriveOklch(base('#0f172a'), [{ lighten: 0.5 }]), [0.603841, 0.019912, 265.754874]);
    near(deriveOklch(primary, [{ mix: { with: base('#ea580c'), amount: 0.5 } }]), [0.596111, 0.204767, 331.998348]);
    // a white (a grey: its hue is powerless) mixed with a colour takes the colour's hue
    near(deriveOklch(base('#ffffff'), [{ mix: { with: primary, amount: 0.25 } }]), [0.886537, 0.053802, 262.880917]);
    // the same through a theme: the emitted CSS is the 8-bit colour nearest the exact one
    const theme = withColors((c) => (c['primary-light'] = color('{color.primary}', [{ lighten: 0.2 }])));
    const css = toCssVars(theme)['--fx-color-primary-light'] as string;
    const back = parseColor(css) as Oklch;
    expect(Math.abs(back.l - 0.63692)).toBeLessThan(0.004);
    expect(Math.abs(back.c - 0.172166)).toBeLessThan(0.006);
  });

  it('FR-THM-002: a derived token follows its source token when the theme changes', () => {
    const derived = (primary: string) =>
      withColors((c) => {
        c['primary'] = color(primary);
        c['hover'] = color('{color.primary}', [{ darken: 0.2 }]);
      });
    const red = toCssVars(derived('#dc2626'))['--fx-color-hover'];
    const blue = toCssVars(derived('#2563eb'))['--fx-color-hover'];
    expect(red).toBe(oklchToCss(deriveOklch(base('#dc2626'), [{ darken: 0.2 }])));
    expect(blue).toBe(oklchToCss(deriveOklch(base('#2563eb'), [{ darken: 0.2 }])));
    expect(red).not.toBe(blue);
    // a derived token of a derived token, and a mix with another token, follow it too
    const chain = withColors((c) => {
      c['a'] = color('{color.primary}', [{ lighten: 0.1 }]);
      c['b'] = color('{color.a}', [{ alpha: 0.5 }]);
      c['m'] = color('{color.primary}', [{ mix: { with: '{color.secondary}', amount: 0.5 } }]);
    });
    expect(validateTheme(chain)).toEqual([]);
    const vars = toCssVars(chain);
    expect(vars['--fx-color-b']).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.5\)$/);
    const mixed = parseColor(vars['--fx-color-m'] as string) as Oklch;
    const exact = deriveOklch(base('#2563eb'), [{ mix: { with: base('#7c3aed'), amount: 0.5 } }]);
    expect(Math.abs(mixed.l - exact.l)).toBeLessThan(0.006);
    expect(Math.abs(mixed.c - exact.c)).toBeLessThan(0.008);
    // a style that references a derived token gets its variable
    expect(resolveStyle({ fill: '{color.hover}' }, 'shape', derived('#2563eb')).style.fill).toEqual({ type: 'color', css: 'var(--fx-color-hover)' });
    // a change of the source colour alone keeps the style key (colours reach views as variables)
    expect(styleKey(derived('#dc2626'))).toBe(styleKey(derived('#2563eb')));
  });

  it('FR-THM-002: a theme with a cycle is reported as FLX_TOKEN_CYCLE and does not loop', () => {
    const theme = withColors((c) => {
      c['a'] = color('{color.primary}', [{ mix: { with: '{color.b}', amount: 0.5 } }]);
      c['b'] = color('{color.a}', [{ lighten: 0.1 }]);
      c['self'] = color('#336699', [{ mix: { with: '{color.self}', amount: 0.5 } }]);
    });
    const found = Object.fromEntries(themeDiagnostics(theme).map((d) => [d.path, d.code]));
    expect(found).toEqual({
      '/tokens/color/a/$value': 'FLX_TOKEN_CYCLE',
      '/tokens/color/b/$value': 'FLX_TOKEN_CYCLE',
      '/tokens/color/self/$value': 'FLX_TOKEN_CYCLE',
    });
    expect(themeDiagnostics(theme).every((d) => d.severity === 'error')).toBe(true);
    const vars = toCssVars(theme);
    for (const n of ['a', 'b', 'self']) expect(vars[`--fx-color-${n}`], n).toBeUndefined();
    // the other tokens are still emitted
    expect(vars['--fx-color-primary']).toBe('#2563eb');
  });

  it('FR-THM-002: a malformed transform is FLX_TOKEN_TRANSFORM and the token is not emitted', () => {
    const bad: ReadonlyArray<readonly [string, unknown]> = [
      ['not a list', { lighten: 0.2 }],
      ['empty', []],
      ['two operations', [{ lighten: 0.2, darken: 0.1 }]],
      ['unknown operation', [{ saturate: 0.2 }]],
      ['over range', [{ lighten: 1.5 }]],
      ['under range', [{ darken: -0.1 }]],
      ['not a number', [{ alpha: '50%' }]],
      ['mix without with', [{ mix: { amount: 0.5 } }]],
      ['mix with a literal', [{ mix: { with: '#ffffff', amount: 0.5 } }]],
      ['mix amount over range', [{ mix: { with: '{color.secondary}', amount: 2 } }]],
    ];
    for (const [name, transform] of bad) {
      const theme = withColors((c) => (c['x'] = color('{color.primary}', transform)));
      const problems = themeDiagnostics(theme);
      expect(
        problems.map((d) => [d.code, d.path]),
        name,
      ).toEqual([['FLX_TOKEN_TRANSFORM', '/tokens/color/x/$value']]);
      expect(toCssVars(theme)['--fx-color-x'], name).toBeUndefined();
    }
    // a colour that cannot be derived from (a named colour) is the same problem, and so is a mix with one
    const named = withColors((c) => (c['x'] = color('rebeccapurple', [{ lighten: 0.1 }])));
    expect(themeDiagnostics(named).map((d) => d.code)).toEqual(['FLX_TOKEN_TRANSFORM']);
    const namedMix = withColors((c) => {
      c['n'] = color('tomato');
      c['x'] = color('{color.primary}', [{ mix: { with: '{color.n}', amount: 0.5 } }]);
    });
    expect(themeDiagnostics(namedMix).map((d) => d.code)).toEqual(['FLX_TOKEN_TRANSFORM']);
    // the same named colour with no transform is a plain literal, as before
    expect(toCssVars(withColors((c) => (c['n'] = color('tomato'))))['--fx-color-n']).toBe('tomato');
  });

  it('FR-THM-002: an extension of another tool is kept, never emitted, and does not make a colour derived', () => {
    const theme = withColors((c) => (c['x'] = { $type: 'color', $value: '#112233', $extensions: { 'org.other': { note: 'a;}</style>' } } }));
    expect(themeSchema.safeParse(theme).success).toBe(true);
    expect(validateTheme(theme)).toEqual([]);
    const vars = toCssVars(theme);
    expect(vars['--fx-color-x']).toBe('#112233');
    expect(JSON.stringify(vars)).not.toContain('</style>');
    // a transform under the Fluxion key on a literal colour derives it
    const lit = withColors((c) => (c['x'] = color('#336699', [{ lighten: 0.5 }])));
    expect(validateTheme(lit)).toEqual([]);
    expect(toCssVars(lit)['--fx-color-x']).toBe(oklchToCss(deriveOklch(base('#336699'), [{ lighten: 0.5 }])));
  });

  it('FR-THM-002: colour forms are read, written back as hex or rgb with alpha, and out-of-gamut results are brought in', () => {
    for (const [css, hex] of [
      ['#2563eb', '#2563eb'],
      ['#26e', '#2266ee'],
      ['rgb(37 99 235)', '#2563eb'],
      ['rgb(37, 99, 235)', '#2563eb'],
      ['rgb(14.5% 38.8% 92.2%)', '#2563eb'],
      ['hsl(221 83% 53%)', '#2563eb'],
    ] as const) {
      const got = oklchToCss(parseColor(css) as Oklch);
      expect(got, css).toMatch(/^#[0-9a-f]{6}$/);
      if (css !== 'hsl(221 83% 53%)') expect(got, css).toBe(hex);
    }
    expect(parseColor('#2563eb80')?.alpha).toBeCloseTo(0.502, 3);
    expect(parseColor('oklch(0.5 0.2 262 / 50%)')).toMatchObject({ l: 0.5, c: 0.2, h: 262, alpha: 0.5 });
    expect(parseColor('oklab(0.5 0 0)')?.c).toBe(0);
    expect(oklchToCss(parseColor('#2563eb80') as Oklch)).toBe('rgb(37 99 235 / 0.502)');
    for (const unsupported of ['rebeccapurple', 'lab(50 20 30)', 'hwb(10 10% 10%)', 'color(display-p3 1 0 0)', 'rgb(1 2)', '#12', 'url(x)'])
      expect(parseColor(unsupported), unsupported).toBeUndefined();
    // a chroma the sRGB gamut cannot hold is reduced, never clipped per channel
    const wild = oklchToCss({ l: 0.7, c: 0.5, h: 150, alpha: 1 });
    expect(wild).toMatch(/^#[0-9a-f]{6}$/);
    const back = parseColor(wild) as Oklch;
    expect(back.c).toBeLessThan(0.5);
    expect(Math.abs(back.h - 150)).toBeLessThan(3);
  });

  it('FR-THM-002: lighten and darken keep lightness in range and order, and alpha only scales opacity (properties)', () => {
    const arb = fc.record({
      r: fc.integer({ min: 0, max: 255 }),
      g: fc.integer({ min: 0, max: 255 }),
      b: fc.integer({ min: 0, max: 255 }),
      n: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(arb, ({ r, g, b, n }) => {
        const c = rgbToOklch(r / 255, g / 255, b / 255);
        const lighter = deriveOklch(c, [{ lighten: n }]);
        const darker = deriveOklch(c, [{ darken: n }]);
        expect(lighter.l).toBeGreaterThanOrEqual(c.l - 1e-9);
        expect(darker.l).toBeLessThanOrEqual(c.l + 1e-9);
        expect(lighter.l).toBeLessThanOrEqual(1 + 1e-9);
        expect(darker.l).toBeGreaterThanOrEqual(-1e-9);
        expect(lighter.c).toBeLessThanOrEqual(c.c + 1e-9);
        expect(deriveOklch(c, [{ alpha: n }]).alpha).toBeCloseTo(n, 9);
        // 0 changes nothing, and the CSS of every result is a well-formed colour
        expect(deriveOklch(c, [{ lighten: 0 }]).l).toBeCloseTo(c.l, 9);
        expect(oklchToCss(lighter)).toMatch(/^#[0-9a-f]{6}$/);
        expect(oklchToCss(deriveOklch(c, [{ alpha: n }]))).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\))$/);
      }),
      { numRuns: 200 },
    );
  });

  it('FR-THM-002: tokens that fan out (each aliased to the next and mixed with it) resolve in linear work, not exponential', () => {
    const fan = (depth: number) => {
      const chain: { [k: string]: unknown } = {};
      for (let i = 0; i < depth; i++) chain[`f${i}`] = color(`{color.f${i + 1}}`, [{ mix: { with: `{color.f${i + 1}}`, amount: 0.5 } }]);
      chain[`f${depth}`] = color('#336699');
      return withColors((c) => Object.assign(c, chain));
    };
    // 2^40 visits without memoisation: it finishes at once, and every token has its colour
    const theme = fan(40);
    const vars = toCssVars(theme);
    expect(vars['--fx-color-f0']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--fx-color-f40']).toBe('#336699');
    expect(validateTheme(theme)).toEqual([]);
    expect(styleKey(theme)).toBeTruthy();
    // 100 deep is past the chain bound: reported, and again at once
    const deep = fan(100);
    expect(themeDiagnostics(deep).some((d) => d.code === 'FLX_TOKEN_CYCLE')).toBe(true);
  }, 5000);

  it('FR-THM-002: a mix takes the shorter hue arc; exactly 180 degrees apart keeps its sign, as CSS does', () => {
    const at = (h: number): Oklch => ({ l: 0.6, c: 0.1, h, alpha: 1 });
    const mixed = (a: number, b: number) => deriveOklch(at(a), [{ mix: { with: at(b), amount: 0.5 } }]).h;
    expect(mixed(0, 180)).toBeCloseTo(90, 6);
    expect(mixed(180, 0)).toBeCloseTo(90, 6);
    expect(mixed(350, 10)).toBeCloseTo(0, 6);
    expect(mixed(10, 350)).toBeCloseTo(0, 6);
    expect(mixed(90, 200)).toBeCloseTo(145, 6);
  });

  it('FR-THM-002: hsl() saturation and lightness are percentages, written with % or as plain numbers', () => {
    const css = (text: string) => oklchToCss(parseColor(text) as Oklch);
    expect(css('hsl(221 83 53)')).toBe(css('hsl(221 83% 53%)'));
    expect(css('hsl(221 100 1)')).toBe(css('hsl(221 100% 1%)'));
    expect(css('hsl(221, 83%, 53%)')).toBe(css('hsla(221 83% 53% / 1)'));
    expect(css('hsl(221 83% 150%)')).toBe('#ffffff');
    expect(css('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(css('hsl(0 0% 0%)')).toBe('#000000');
    expect(css('hsl(0.5turn 100% 50%)')).toBe(css('hsl(180 100% 50%)'));
  });

  it('FR-THM-002: the chain bound holds whatever the order of lookups', () => {
    const chain: { [k: string]: unknown } = {};
    for (let i = 0; i < 80; i++) chain[`d${i}`] = color(`{color.d${i + 1}}`);
    chain['d80'] = color('#336699');
    const theme = withColors((c) => Object.assign(c, chain));
    const fresh = colorResolver(theme)('color.d0');
    expect(fresh.ok).toBe(false);
    // a resolver that already resolved a token in the middle of the chain gives the same answer for the top of it
    const follow = colorResolver(theme);
    expect(follow('color.d50').ok).toBe(true);
    expect(follow('color.d0')).toEqual(fresh);
    // the bound is on the chain: 65 links fail, 64 pass, in either order
    expect(follow('color.d16').ok).toBe(false);
    expect(follow('color.d17').ok).toBe(true);
    expect(colorResolver(theme)('color.d16').ok).toBe(false);
    expect(colorResolver(theme)('color.d17').ok).toBe(true);
  });

  it('FR-THM-002: the chain of derived tokens is bounded, and every link must be a valid colour token', () => {
    const chain: { [k: string]: unknown } = {};
    for (let i = 0; i < 80; i++) chain[`d${i}`] = color(`{color.d${i + 1}}`, [{ lighten: 0.01 }]);
    chain['d80'] = color('#336699');
    const theme = withColors((c) => Object.assign(c, chain));
    const r = followColor(theme, 'color.d0');
    expect(!r.ok && r.error.code).toBe('TOKEN_CYCLE');
    expect(followColor(theme, 'color.d40').ok).toBe(true);
    // a link that is not a valid colour carries no string into the result
    const evil = withColors((c) => {
      c['evil'] = color('red;}</style>');
      c['x'] = color('{color.evil}', [{ lighten: 0.1 }]);
    });
    const bad = followColor(evil, 'color.x');
    expect(!bad.ok && bad.error.code).toBe('TOKEN_TYPE');
    expect(toCssVars(evil)['--fx-color-x']).toBeUndefined();
  });
});
