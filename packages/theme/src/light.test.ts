import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { validateTheme } from './validate-theme.js';

// The light theme is the default of every document without a theme, so each of its values is
// what such a document renders with. This file pins all of them, written out in full rather than
// through the helpers light.ts builds them with.
const c = ($value: string) => ({ $type: 'color', $value });
const px = (value: number) => ({ $type: 'dimension', $value: { value, unit: 'px' } });
const ms = (value: number) => ({ $type: 'duration', $value: { value, unit: 'ms' } });
const sans = { $type: 'fontFamily', $value: ['Inter', 'system-ui', 'sans-serif'] };

describe('the light theme (FR-THM-001)', () => {
  it('FR-THM-001: is a valid theme named light', () => {
    expect(LIGHT_THEME.name).toBe('light');
    expect(validateTheme(LIGHT_THEME)).toEqual([]);
  });

  it('FR-THM-001: has exactly these colour roles', () => {
    expect(LIGHT_THEME.tokens['color']).toStrictEqual({
      background: c('#ffffff'),
      surface: c('#f8fafc'),
      text: c('#0f172a'),
      muted: c('#64748b'),
      primary: c('#2563eb'),
      secondary: c('#7c3aed'),
      'accent-1': c('#0891b2'),
      'accent-2': c('#16a34a'),
      'accent-3': c('#ca8a04'),
      'accent-4': c('#ea580c'),
      'accent-5': c('#db2777'),
      'accent-6': c('#4f46e5'),
      success: c('#16a34a'),
      warning: c('#d97706'),
      danger: c('#dc2626'),
      info: c('#0284c7'),
      connector: c('#334155'),
    });
  });

  it('FR-THM-001: has exactly these font tokens', () => {
    expect(LIGHT_THEME.tokens['font']).toStrictEqual({
      heading: sans,
      body: sans,
      mono: { $type: 'fontFamily', $value: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
      size: { sm: px(14), md: px(18), lg: px(24), xl: px(36) },
      weight: { regular: { $type: 'fontWeight', $value: 400 }, bold: { $type: 'fontWeight', $value: 700 } },
      'line-height': { normal: { $type: 'number', $value: 1.3 } },
    });
  });

  it('FR-THM-001: has exactly these space, radius, stroke, shadow and motion tokens', () => {
    const { color: _c, font: _f, ...rest } = LIGHT_THEME.tokens;
    const shadow = (offsetY: number, blur: number, spread: number, color: string) => ({
      $type: 'shadow',
      $value: { color, offsetX: 0, offsetY, blur, spread },
    });
    const bezier = (...$value: number[]) => ({ $type: 'cubicBezier', $value });
    expect(rest).toStrictEqual({
      space: { xs: px(4), sm: px(8), md: px(16), lg: px(24), xl: px(40) },
      radius: { none: px(0), sm: px(4), md: px(8), lg: px(16) },
      stroke: { thin: px(1), regular: px(2), thick: px(4) },
      shadow: {
        sm: shadow(1, 2, 0, '#0f172a1f'),
        md: shadow(4, 12, 0, '#0f172a29'),
        lg: shadow(12, 32, -4, '#0f172a33'),
      },
      motion: {
        duration: { fast: ms(120), normal: ms(240), slow: ms(480) },
        easing: { standard: bezier(0.2, 0, 0, 1), in: bezier(0.4, 0, 1, 1), out: bezier(0, 0, 0.2, 1) },
      },
    });
  });

  it('FR-THM-001: has exactly these element defaults', () => {
    expect(LIGHT_THEME.defaults).toStrictEqual({
      shape: { fill: '{color.surface}', stroke: { color: '{color.text}', width: '{stroke.regular}' }, radius: '{radius.none}' },
      connector: { stroke: { color: '{color.connector}', width: '{stroke.regular}' } },
      frame: { fill: '{color.surface}', stroke: { width: 0 } },
      screen: { background: '{color.background}' },
      '*': {
        font: { family: '{font.body}', size: '{font.size.md}', lineHeight: '{font.line-height.normal}', color: '{color.text}' },
      },
    });
  });
});
