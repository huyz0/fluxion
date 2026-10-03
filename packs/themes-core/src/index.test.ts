import { contrastRatio, createCoreRegistries, LIGHT_THEME, type ThemeDef, validateTheme } from '@fluxion/sdk';
import { describe, expect, it } from 'vitest';
import { makeTheme } from './build.js';
import { THEMES_CORE, themesCorePack } from './index.js';

const NAMES = ['light', 'dark', 'corporate', 'vibrant', 'pastel', 'high-contrast', 'blueprint', 'chalkboard'];

/** The literal colour of role `role` of `theme`. */
const role = (theme: ThemeDef, name: string): string => ((theme.tokens['color'] as { [k: string]: { $value: string } })[name] as { $value: string }).$value;

describe('the themes-core pack (FR-THM-003)', () => {
  it('FR-THM-003: the pack lists the eight built-in themes', () => {
    expect(THEMES_CORE.map((t) => t.name)).toEqual(NAMES);
    expect(THEMES_CORE.map((t) => t.id)).toEqual(NAMES.map((n) => `themes-core:${n}`));
    expect(themesCorePack.themes).toBe(THEMES_CORE);
    // the light theme is the built-in default, not a lookalike
    expect(THEMES_CORE[0]?.tokens).toEqual(LIGHT_THEME.tokens);
    // registered like any pack: all eight under the pack's namespace
    const registries = createCoreRegistries();
    const done = themesCorePack.register(registries);
    expect(done.ok).toBe(true);
    for (const n of NAMES) expect(registries.themes.get(`themes-core:${n}`), n).toBeDefined();
    expect(registries.themes.source('themes-core:dark')).toBe('themes-core');
    if (done.ok) done.value.dispose();
    expect(registries.themes.get('themes-core:dark')).toBeUndefined();
    // the themes differ from each other: every one has a background of its own
    expect(new Set(THEMES_CORE.map((t) => role(t, 'background'))).size).toBe(7); // light and corporate share white
  });

  it('FR-THM-001: every theme in the pack validates against the full token schema', () => {
    for (const theme of THEMES_CORE) expect(validateTheme(theme), theme.name).toEqual([]);
    // each has the shadows, the motion and the six accents of the model
    for (const theme of THEMES_CORE) {
      expect(Object.keys(theme.tokens['shadow'] as object), theme.name).toEqual(['sm', 'md', 'lg']);
      expect(Object.keys(theme.tokens['motion'] as object), theme.name).toEqual(['duration', 'easing']);
      for (let i = 1; i <= 6; i++) expect(role(theme, `accent-${i}`), `${theme.name} accent-${i}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("FR-THM-003: every theme's text and background role pairs meet WCAG AA 4.5:1", () => {
    for (const theme of THEMES_CORE) {
      const min = theme.name === 'high-contrast' ? 7 : 4.5;
      for (const [fg, bg] of [
        ['text', 'background'],
        ['text', 'surface'],
        ['muted', 'background'],
        ['muted', 'surface'],
      ] as const) {
        const ratio = contrastRatio(role(theme, fg), role(theme, bg));
        expect(ratio, `${theme.name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
      // a connector is a line over the background: 3:1, the WCAG bar for graphics
      expect(contrastRatio(role(theme, 'connector'), role(theme, 'background')), `${theme.name}: connector`).toBeGreaterThanOrEqual(3);
    }
    // the pairs are measured, not assumed: a pair that fails is seen as failing
    expect(contrastRatio('#777777', '#808080')).toBeLessThan(4.5);
  });
});

describe('makeTheme (FR-THM-003)', () => {
  const accents = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'] as const;
  const palette = {
    background: '#ffffff',
    surface: '#ffffff',
    text: '#000000',
    muted: '#333333',
    primary: '#0000ff',
    secondary: '#005500',
    accents,
    success: '#006600',
    warning: '#885500',
    danger: '#aa0000',
    info: '#0000aa',
    connector: '#444444',
  };

  it('FR-THM-003: a theme without extras keeps the light structure; extras replace the defaults', () => {
    const plain = makeTheme('A b!', palette);
    expect(plain.id).toBe('themes-core:a-b-');
    expect(plain.defaults).toEqual(LIGHT_THEME.defaults);
    expect(makeTheme('C', palette, { defaults: {} }).defaults).toEqual({});
  });
});
