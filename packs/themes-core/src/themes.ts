// The eight built-in themes (FR-THM-003): light, dark, corporate, vibrant, pastel, high-contrast, blueprint, chalkboard. Their
// text and background roles meet WCAG AA 4.5:1 (high-contrast: 7:1, AAA), checked by the pack's tests.
import { LIGHT_THEME, type ThemeDef } from '@fluxion/sdk';
import { family, makeTheme, px } from './build.js';

const SANS = family('Inter', 'system-ui', 'sans-serif');
const MONO = family('JetBrains Mono', 'ui-monospace', 'monospace');

/** The light theme's colours, as the pack carries it (the built-in default). */
export const light: ThemeDef = { ...LIGHT_THEME, id: 'themes-core:light', name: 'light' };

export const dark: ThemeDef = makeTheme(
  'dark',
  {
    background: '#0b1020',
    surface: '#151b2e',
    text: '#e5e9f5',
    muted: '#9aa6c4',
    primary: '#6ea8ff',
    secondary: '#b79cff',
    accents: ['#38bdf8', '#4ade80', '#facc15', '#fb923c', '#f472b6', '#818cf8'],
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#38bdf8',
    connector: '#aab4d4',
  },
  {
    groups: {
      shadow: {
        sm: { $type: 'shadow', $value: { color: '#00000066', offsetX: 0, offsetY: 1, blur: 2, spread: 0 } },
        md: { $type: 'shadow', $value: { color: '#00000080', offsetX: 0, offsetY: 4, blur: 12, spread: 0 } },
        lg: { $type: 'shadow', $value: { color: '#00000099', offsetX: 0, offsetY: 12, blur: 32, spread: -4 } },
      },
    },
  },
);

export const corporate: ThemeDef = makeTheme(
  'corporate',
  {
    background: '#ffffff',
    surface: '#eef2f7',
    text: '#0b2545',
    muted: '#4a5d73',
    primary: '#13315c',
    secondary: '#2e6f95',
    accents: ['#2e6f95', '#3a7d44', '#b07d00', '#c2410c', '#9d174d', '#5b21b6'],
    success: '#2f7d3b',
    warning: '#b45309',
    danger: '#b91c1c',
    info: '#1d6fa5',
    connector: '#3b4a5c',
  },
  { groups: { radius: { none: px(0), sm: px(2), md: px(4), lg: px(8) } } },
);

export const vibrant: ThemeDef = makeTheme(
  'vibrant',
  {
    background: '#fffbf2',
    surface: '#fff1d6',
    text: '#1a1033',
    muted: '#5b4a78',
    primary: '#e11d48',
    secondary: '#7c3aed',
    accents: ['#0ea5e9', '#22c55e', '#f59e0b', '#f97316', '#ec4899', '#6366f1'],
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#0284c7',
    connector: '#3b2a5c',
  },
  { groups: { radius: { none: px(0), sm: px(6), md: px(12), lg: px(24) }, stroke: { thin: px(1), regular: px(3), thick: px(5) } } },
);

export const pastel: ThemeDef = makeTheme(
  'pastel',
  {
    background: '#fffdf9',
    surface: '#f4eefa',
    text: '#34304a',
    muted: '#625d7c',
    primary: '#6f93d6',
    secondary: '#a98bd6',
    accents: ['#7cc4c4', '#8fcf9f', '#e6c47a', '#eaa38a', '#e48fb4', '#9aa0e6'],
    success: '#6fbf8a',
    warning: '#e3b25d',
    danger: '#e08585',
    info: '#7fb2e0',
    connector: '#6a6580',
  },
  { groups: { radius: { none: px(0), sm: px(8), md: px(16), lg: px(28) }, stroke: { thin: px(1), regular: px(1.5), thick: px(3) } } },
);

export const highContrast: ThemeDef = makeTheme(
  'high-contrast',
  {
    background: '#000000',
    surface: '#0d0d0d',
    text: '#ffffff',
    muted: '#e6e6e6',
    primary: '#ffd400',
    secondary: '#00e5ff',
    accents: ['#00e5ff', '#7cff7c', '#ffd400', '#ff9f1c', '#ff66cc', '#a5b4ff'],
    success: '#00ff7f',
    warning: '#ffd400',
    danger: '#ff5555',
    info: '#00e5ff',
    connector: '#ffffff',
  },
  { groups: { stroke: { thin: px(2), regular: px(3), thick: px(6) } } },
);

export const blueprint: ThemeDef = makeTheme(
  'blueprint',
  {
    background: '#0b3d91',
    surface: '#0f4aa8',
    text: '#f2f7ff',
    muted: '#cfe0ff',
    primary: '#ffffff',
    secondary: '#9ec5ff',
    accents: ['#7fd1ff', '#8affc1', '#ffe48a', '#ffb38a', '#ffa6d5', '#c3b5ff'],
    success: '#8affc1',
    warning: '#ffe48a',
    danger: '#ff9e9e',
    info: '#7fd1ff',
    connector: '#cfe0ff',
  },
  {
    groups: {
      font: { ...(LIGHT_THEME.tokens['font'] as object), heading: MONO, body: MONO, mono: MONO },
      radius: { none: px(0), sm: px(0), md: px(0), lg: px(2) },
      stroke: { thin: px(1), regular: px(1.5), thick: px(3) },
    },
  },
);

export const chalkboard: ThemeDef = makeTheme(
  'chalkboard',
  {
    background: '#26332e',
    surface: '#2f3f39',
    text: '#f4f1e8',
    muted: '#cdd5cb',
    primary: '#ffd966',
    secondary: '#9ad1d4',
    accents: ['#ffd966', '#a3d9a5', '#f2c46d', '#f2a07b', '#e8a0bf', '#a7b8f2'],
    success: '#a3d9a5',
    warning: '#f2c46d',
    danger: '#f28b82',
    info: '#9ad1d4',
    connector: '#e8e4d4',
  },
  {
    groups: {
      font: { ...(LIGHT_THEME.tokens['font'] as object), heading: family('Chalkboard SE', 'Comic Sans MS', 'cursive'), body: SANS },
      radius: { none: px(0), sm: px(6), md: px(12), lg: px(20) },
      stroke: { thin: px(2), regular: px(3), thick: px(5) },
    },
  },
);

/**
 * The eight themes, in the order the picker lists them.
 *
 * @public
 */
export const THEMES_CORE: readonly ThemeDef[] = [light, dark, corporate, vibrant, pastel, highContrast, blueprint, chalkboard];
