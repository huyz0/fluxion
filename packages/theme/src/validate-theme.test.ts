import { describe, expect, it } from 'vitest';
import { followColor } from './alias.js';
import { LIGHT_THEME } from './light.js';
import { cssValue, toCssVars } from './resolve.js';
import { resolveStyle } from './resolve-style.js';
import { type Theme, type TokenGroup, themeSchema } from './tokens.js';
import { REQUIRED_COLOR_ROLES, validateTheme } from './validate-theme.js';

const color = ($value: string) => ({ $type: 'color' as const, $value });
/** The light theme with `color` replaced by `roles` (and the rest unchanged). */
const withColors = (roles: TokenGroup): Theme => ({ ...LIGHT_THEME, tokens: { ...LIGHT_THEME.tokens, color: roles } });
/** The light theme's colour group with one role replaced or removed. */
const colors = (change: (c: { [k: string]: unknown }) => void): TokenGroup => {
  const c = { ...(LIGHT_THEME.tokens['color'] as { [k: string]: unknown }) };
  change(c);
  return c as TokenGroup;
};

describe('validateTheme (FR-THM-001, ADR-0152)', () => {
  it('FR-THM-001: the built-in light theme validates against the full token schema', () => {
    expect(validateTheme(LIGHT_THEME)).toEqual([]);
    expect(validateTheme(JSON.parse(JSON.stringify(LIGHT_THEME)))).toEqual([]);
    // the requirement's roles are the ones required
    expect(REQUIRED_COLOR_ROLES).toHaveLength(17);
    expect(REQUIRED_COLOR_ROLES).toContain('connector');
    expect(REQUIRED_COLOR_ROLES.filter((r) => r.startsWith('accent-'))).toHaveLength(6);
    // typography, spacing, radii, stroke widths, shadows and motion are all there
    for (const group of ['font', 'space', 'radius', 'stroke', 'shadow', 'motion']) expect(LIGHT_THEME.tokens[group], group).toBeDefined();
  });

  it('FR-THM-001: a missing role is a diagnostic naming its path', () => {
    const problems = validateTheme(withColors(colors((c) => delete c['connector'])));
    expect(problems).toEqual([{ code: 'ROLE_MISSING', path: '/tokens/color/connector', message: 'theme light has no colour role connector' }]);
    // every role, one at a time
    for (const role of REQUIRED_COLOR_ROLES) {
      const p = validateTheme(withColors(colors((c) => delete c[role])));
      expect(
        p.map((x) => x.path),
        role,
      ).toEqual([`/tokens/color/${role}`]);
    }
    // a role that is a group is the wrong type
    expect(validateTheme(withColors(colors((c) => (c['text'] = { dark: color('#000000') })))).map((p) => [p.code, p.path])).toEqual([
      ['TOKEN_TYPE', '/tokens/color/text'],
    ]);
  });

  it('FR-THM-001: a token of the wrong type for its group, and a schema refusal, are diagnostics with paths', () => {
    const wrong = { ...LIGHT_THEME, tokens: { ...LIGHT_THEME.tokens, space: { md: { $type: 'number', $value: 16 } } } };
    expect(validateTheme(wrong).map((p) => [p.code, p.path])).toEqual([['TOKEN_TYPE', '/tokens/space/md/$type']]);
    const refused = validateTheme({ name: 'x', tokens: { color: { deep: { a: { $type: 'color', $value: 3 } } } } });
    expect(refused[0]).toMatchObject({ code: 'THEME_INVALID', path: '/tokens/color/deep/a/$value' });
    expect(validateTheme(42)[0]?.code).toBe('THEME_INVALID');
  });

  it('FR-THM-001: shadow, duration and cubic-bezier tokens validate and emit as CSS', () => {
    const vars = toCssVars(LIGHT_THEME);
    expect(vars['--fx-shadow-sm']).toBe('0px 1px 2px 0px #0f172a1f');
    expect(vars['--fx-motion-duration-normal']).toBe('240ms');
    expect(vars['--fx-motion-easing-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)');
    const bad = (token: unknown) => themeSchema.safeParse({ name: 'x', tokens: { t: token } }).success;
    expect(bad({ $type: 'shadow', $value: { color: '#000000', offsetX: 0, offsetY: 1, blur: -1, spread: 0 } })).toBe(false);
    expect(bad({ $type: 'shadow', $value: { color: 'url(x)', offsetX: 0, offsetY: 1, blur: 1, spread: 0 } })).toBe(false);
    expect(bad({ $type: 'duration', $value: { value: -5, unit: 'ms' } })).toBe(false);
    expect(bad({ $type: 'duration', $value: { value: 5, unit: 's' } })).toBe(false);
    expect(bad({ $type: 'cubicBezier', $value: [2, 0, 0, 1] })).toBe(false);
    expect(bad({ $type: 'cubicBezier', $value: [0, 0, 1] })).toBe(false);
    expect(cssValue({ $type: 'duration', $value: { value: 1, unit: 'ms' } })).toBe('1ms');
  });

  it('FR-THM-001: a colour token may alias another; the alias is emitted as the literal it resolves to', () => {
    const theme = withColors(
      colors((c) => {
        c['focus'] = color('{color.primary}');
        c['link'] = color('{color.focus}');
      }),
    );
    expect(validateTheme(theme)).toEqual([]);
    const vars = toCssVars(theme);
    expect(vars['--fx-color-focus']).toBe('#2563eb');
    expect(vars['--fx-color-link']).toBe('#2563eb');
    // a style that references the alias gets the variable, not the alias text
    const { style } = resolveStyle({ fill: '{color.link}' }, 'shape', theme);
    expect(style.fill).toEqual({ type: 'color', css: 'var(--fx-color-link)' });
    // a chain is followed to its literal
    const followed = followColor(theme, 'color.link');
    expect(followed).toEqual({ ok: true, value: '#2563eb' });
  });

  it('FR-THM-001: an alias to nothing, to a non-colour and in a circle is a diagnostic, and is not emitted', () => {
    const theme = withColors(
      colors((c) => {
        c['gone'] = color('{color.nope}');
        c['typed'] = color('{space.md}');
        c['a'] = color('{color.b}');
        c['b'] = color('{color.a}');
        c['self'] = color('{color.self}');
      }),
    );
    const byPath = Object.fromEntries(validateTheme(theme).map((p) => [p.path, p.code]));
    expect(byPath).toEqual({
      '/tokens/color/gone/$value': 'TOKEN_UNKNOWN',
      '/tokens/color/typed/$value': 'TOKEN_TYPE',
      '/tokens/color/a/$value': 'TOKEN_CYCLE',
      '/tokens/color/b/$value': 'TOKEN_CYCLE',
      '/tokens/color/self/$value': 'TOKEN_CYCLE',
    });
    const vars = toCssVars(theme);
    for (const name of ['gone', 'typed', 'a', 'b', 'self']) expect(vars[`--fx-color-${name}`], name).toBeUndefined();
    // a style naming one is reported like an unknown token and falls back
    const cyc = followColor(theme, 'color.a');
    expect(!cyc.ok && cyc.error.code).toBe('TOKEN_CYCLE');
    expect(!cyc.ok && cyc.error.message).toContain('{color.a} -> {color.b} -> {color.a}');
    const { diagnostics } = resolveStyle({ fill: '{color.a}' }, 'shape', theme);
    expect(diagnostics.map((d) => d.code)).toContain('FLX_TOKEN_UNKNOWN');
  });

  it('FR-THM-001: an alias to an invalid literal is not emitted and carries no string into CSS (M4 safety invariant)', () => {
    // a theme object that never went through themeSchema: the target is not a colour, and the alias to it matches the alias form
    const theme = withColors(
      colors((c) => {
        c['evil'] = color('red;}</style><x>');
        c['alias'] = color('{color.evil}');
        c['again'] = color('{color.alias}');
      }),
    );
    const vars = toCssVars(theme);
    for (const name of ['evil', 'alias', 'again']) expect(vars[`--fx-color-${name}`], name).toBeUndefined();
    expect(JSON.stringify(vars)).not.toContain('</style>');
    const r = followColor(theme, 'color.again');
    expect(!r.ok && r.error.code).toBe('TOKEN_TYPE');
    const { style, diagnostics } = resolveStyle({ fill: '{color.alias}' }, 'shape', theme);
    expect(JSON.stringify(style)).not.toContain('var(--fx-color-alias)');
    expect(diagnostics.map((d) => d.code)).toContain('FLX_TOKEN_UNKNOWN');
  });

  it('FR-THM-001: an alias chain that never ends is cut off, not looped over', () => {
    const chain: { [k: string]: unknown } = {};
    for (let i = 0; i < 100; i++) chain[`c${i}`] = color(`{color.c${i + 1}}`);
    chain['c100'] = color('#000000');
    const theme = withColors(colors((c) => Object.assign(c, chain)));
    const r = followColor(theme, 'color.c0');
    expect(!r.ok && r.error.code).toBe('TOKEN_CYCLE');
    expect(followColor(theme, 'color.c60')).toEqual({ ok: true, value: '#000000' });
  });
});
