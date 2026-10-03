import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { styleKey } from './style-key.js';
import type { Theme, TokenGroup } from './tokens.js';

const group = (name: string) => LIGHT_THEME.tokens[name] as TokenGroup;
const withToken = (name: string, token: string, value: unknown): Theme =>
  ({ ...LIGHT_THEME, tokens: { ...LIGHT_THEME.tokens, [name]: { ...group(name), [token]: value } } }) as Theme;

describe('styleKey (04 §2.3, ADR-0015 amendment of M5.13)', () => {
  it('FR-SHP-004: only a change of colours keeps the key; sizes, fonts, defaults and token sets change it', () => {
    const key = styleKey(LIGHT_THEME);
    expect(styleKey({ ...LIGHT_THEME })).toBe(key);
    // colours reach views as CSS variables
    expect(styleKey(withToken('color', 'primary', { $type: 'color', $value: '#ff0000' }))).toBe(key);
    // what views measure or lay out with does not
    const [size] = Object.keys(group('stroke'));
    expect(styleKey(withToken('stroke', size as string, { $type: 'dimension', $value: { value: 99, unit: 'px' } }))).not.toBe(key);
    expect(styleKey({ ...LIGHT_THEME, defaults: { shape: { opacity: 0.5 } } })).not.toBe(key);
    // a new token, another type, or a value that stops being valid
    expect(styleKey(withToken('color', 'brand', { $type: 'color', $value: '#00ff00' }))).not.toBe(key);
    expect(styleKey(withToken('color', 'primary', { $type: 'dimension', $value: { value: 1, unit: 'px' } }))).not.toBe(key);
    expect(styleKey(withToken('color', 'primary', { $type: 'color', $value: 'red; x: y' }))).not.toBe(key);
  });

  it('FR-SHP-004: an alias that resolves keeps the key when its target changes; one that stops resolving changes it', () => {
    const aliased = withToken('color', 'brand', { $type: 'color', $value: '{color.primary}' });
    const key = styleKey(aliased);
    // another colour behind the alias: the variable is still emitted, so views need not re-render
    expect(styleKey(withToken('color', 'brand', { $type: 'color', $value: '{color.secondary}' }))).toBe(key);
    // an alias to nothing, or in a circle: its variable goes, and styles using it fall back
    expect(styleKey(withToken('color', 'brand', { $type: 'color', $value: '{color.nope}' }))).not.toBe(key);
    expect(styleKey(withToken('color', 'brand', { $type: 'color', $value: '{color.brand}' }))).not.toBe(key);
  });
});
