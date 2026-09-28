import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { cssValue, resolveToken, toCssVars, tokenPath } from './resolve.js';
import { cssVarName, isToken, type Theme, themeSchema } from './tokens.js';

describe('theme tokens (FR-THM-001)', () => {
  it('FR-THM-001: {color.primary} resolves to the light theme value', () => {
    const r = resolveToken(LIGHT_THEME, '{color.primary}');
    expect(r.ok && r.value).toEqual({ $type: 'color', $value: '#2563eb' });
    const size = resolveToken(LIGHT_THEME, '{font.size.md}');
    expect(size.ok && cssValue(size.value)).toBe('18px');
  });

  it('an unknown path or a group is not a token', () => {
    const unknown = resolveToken(LIGHT_THEME, '{color.nope}');
    expect(!unknown.ok && unknown.error).toEqual({ code: 'TOKEN_UNKNOWN', message: 'theme light has no token {color.nope}' });
    const group = resolveToken(LIGHT_THEME, '{color}');
    expect(!group.ok && group.error.code).toBe('TOKEN_NOT_A_VALUE');
    expect(!group.ok && group.error.message).toContain('{color}');
    // a path through a token, and an inherited property name, are unknown too
    expect(resolveToken(LIGHT_THEME, '{color.primary.x}').ok).toBe(false);
    expect(resolveToken(LIGHT_THEME, '{color.toString}').ok).toBe(false);
  });

  it('FR-THM-001: toCssVars emits --fx-color-primary', () => {
    const vars = toCssVars(LIGHT_THEME);
    expect(vars['--fx-color-primary']).toBe('#2563eb');
    expect(vars['--fx-color-accent-3']).toBe('#ca8a04');
    expect(vars['--fx-font-body']).toBe('"Inter", system-ui, sans-serif');
    expect(vars['--fx-font-mono']).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(vars['--fx-space-md']).toBe('16px');
    expect(vars['--fx-stroke-regular']).toBe('2px');
    expect(vars['--fx-font-weight-bold']).toBe('700');
    expect(vars['--fx-font-line-height-normal']).toBe('1.3');
    // one variable per token, every name prefixed, in tree order
    const names = Object.keys(vars);
    expect(names.every((n) => n.startsWith('--fx-'))).toBe(true);
    expect(names[0]).toBe('--fx-color-background');
    expect(names).toHaveLength(17 + 3 + 4 + 2 + 1 + 5 + 4 + 3);
  });

  it('FR-THM-001: the light theme has every colour role of the requirement', () => {
    const roles = ['background', 'surface', 'text', 'muted', 'primary', 'secondary', 'success', 'warning', 'danger', 'info', 'connector'];
    for (const role of [...roles, ...[1, 2, 3, 4, 5, 6].map((n) => `accent-${n}`)]) expect(resolveToken(LIGHT_THEME, `{color.${role}}`).ok, role).toBe(true);
    for (const f of ['heading', 'body', 'mono']) expect(resolveToken(LIGHT_THEME, `{font.${f}}`).ok, f).toBe(true);
  });

  it('FR-THM-001: theme JSON validates; malformed tokens and names are refused', () => {
    expect(themeSchema.safeParse(JSON.parse(JSON.stringify(LIGHT_THEME))).success).toBe(true);
    const bad = (tokens: unknown) => themeSchema.safeParse({ name: 'x', tokens }).success;
    expect(bad({ color: { a: { $type: 'color', $value: '' } } })).toBe(false);
    expect(bad({ space: { a: { $type: 'dimension', $value: { value: 4, unit: 'em' } } } })).toBe(false);
    expect(bad({ a: { $type: 'shadow', $value: 1 } })).toBe(false);
    expect(bad({ 'has space': { $type: 'number', $value: 1 } })).toBe(false);
    expect(bad({ font: { w: { $type: 'fontWeight', $value: 1001 } } })).toBe(false);
    // the issue path points into the tree
    const r = themeSchema.safeParse({ name: 'x', tokens: { color: { deep: { a: { $type: 'color', $value: 3 } } } } });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]?.path).toEqual(['tokens', 'color', 'deep', 'a', '$value']);
    expect(themeSchema.safeParse({ name: '', tokens: {} }).success).toBe(false);
    expect(bad({ fonts: { f: { $type: 'fontFamily', $value: [] } } })).toBe(false);
  });

  it('paths, names and values', () => {
    expect(tokenPath('{color.accent-2}')).toBe('color.accent-2');
    expect(cssVarName('font.size.md')).toBe('--fx-font-size-md');
    expect(cssValue({ $type: 'fontFamily', $value: 'Georgia' })).toBe('"Georgia"');
    expect(cssValue({ $type: 'fontFamily', $value: ['3Dumb', 'Foo/Bar', 'serif'] })).toBe('"3Dumb", "Foo/Bar", serif');
    // a quote or backslash in a name is escaped inside the CSS string (M4.9 review F2)
    expect(cssValue({ $type: 'fontFamily', $value: 'A "B\\C' })).toBe('"A \\"B\\\\C"');
    expect(cssValue({ $type: 'fontFamily', $value: 'Times New Roman' })).toBe('"Times New Roman"');
    expect(cssValue({ $type: 'number', $value: 0 })).toBe('0');
    expect(isToken({ $type: 'number', $value: 1 })).toBe(true);
    expect(isToken({ a: { $type: 'number', $value: 1 } })).toBe(false);
    expect(isToken(undefined)).toBe(false);
    const custom: Theme = { name: 'c', tokens: { a: { b: { $type: 'number', $value: 2 } } } };
    expect(toCssVars(custom)).toEqual({ '--fx-a-b': '2' });
  });

  it('FR-THM-001: a theme whose tokens share a CSS variable is refused (M4.9 review F1)', () => {
    const r = themeSchema.safeParse({ name: 'x', tokens: { a: { 'b-c': { $type: 'number', $value: 1 } }, 'a-b': { c: { $type: 'number', $value: 2 } } } });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.map((i) => i.message)).toEqual(['a-b.c and a.b-c are both --fx-a-b-c']);
    expect(!r.success && r.error.issues[0]?.path).toEqual(['tokens', 'a-b', 'c']);
    // distinct names pass
    expect(themeSchema.safeParse({ name: 'x', tokens: { a: { b: { $type: 'number', $value: 1 } }, c: { $type: 'number', $value: 2 } } }).success).toBe(true);
  });

  it('FR-THM-001: token values that could carry other CSS are refused (M4.9 review F2)', () => {
    const parses = (token: unknown) => themeSchema.safeParse({ name: 'x', tokens: { t: token } }).success;
    for (const $value of ['red; background: url(x)', 'rgb(1 2 3); x: y', '#12', 'var(--x)', 'url(https://x)', 'red}'])
      expect(parses({ $type: 'color', $value }), $value).toBe(false);
    for (const $value of ['#fff', '#2563ebcc', 'rgb(1 2 3)', 'oklch(0.5 0.1 20 / 50%)', 'rebeccapurple', 'transparent'])
      expect(parses({ $type: 'color', $value }), $value).toBe(true);
    for (const $value of ['A</style><script>', 'line\nbreak', ['ok', 'bad>']]) expect(parses({ $type: 'fontFamily', $value }), String($value)).toBe(false);
    expect(parses({ $type: 'fontFamily', $value: ['Foo "Bar"', 'serif'] })).toBe(true);
  });
});
