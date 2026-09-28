// The built-in `light` theme (FR-THM-001 colour roles; FR-THM-003 lists the other built-ins for M9).
import type { Theme, Token } from './tokens.js';

const color = ($value: string): Token => ({ $type: 'color', $value });
const px = (value: number): Token => ({ $type: 'dimension', $value: { value, unit: 'px' } });
const family = (...$value: string[]): Token => ({ $type: 'fontFamily', $value });

/**
 * The light theme: the default of every document without a theme.
 *
 * @public
 */
export const LIGHT_THEME: Theme = {
  name: 'light',
  tokens: {
    color: {
      background: color('#ffffff'),
      surface: color('#f8fafc'),
      text: color('#0f172a'),
      muted: color('#64748b'),
      primary: color('#2563eb'),
      secondary: color('#7c3aed'),
      'accent-1': color('#0891b2'),
      'accent-2': color('#16a34a'),
      'accent-3': color('#ca8a04'),
      'accent-4': color('#ea580c'),
      'accent-5': color('#db2777'),
      'accent-6': color('#4f46e5'),
      success: color('#16a34a'),
      warning: color('#d97706'),
      danger: color('#dc2626'),
      info: color('#0284c7'),
      connector: color('#334155'),
    },
    font: {
      heading: family('Inter', 'system-ui', 'sans-serif'),
      body: family('Inter', 'system-ui', 'sans-serif'),
      mono: family('JetBrains Mono', 'ui-monospace', 'monospace'),
      size: { sm: px(14), md: px(18), lg: px(24), xl: px(36) },
      weight: { regular: { $type: 'fontWeight', $value: 400 }, bold: { $type: 'fontWeight', $value: 700 } },
      'line-height': { normal: { $type: 'number', $value: 1.3 } },
    },
    space: { xs: px(4), sm: px(8), md: px(16), lg: px(24), xl: px(40) },
    radius: { none: px(0), sm: px(4), md: px(8), lg: px(16) },
    stroke: { thin: px(1), regular: px(2), thick: px(4) },
  },
  defaults: {
    shape: { fill: '{color.surface}', stroke: { color: '{color.text}', width: '{stroke.regular}' }, radius: '{radius.none}' },
    connector: { stroke: { color: '{color.connector}', width: '{stroke.regular}' } },
  },
};
