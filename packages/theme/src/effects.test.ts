import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { resolveStyle } from './resolve-style.js';
import type { Theme } from './tokens.js';

const theme: Theme = { ...LIGHT_THEME, defaults: { shape: { shadow: [{ x: 1, y: 2, blur: 3, color: '#111111' }] } } };

describe('shadows and effects (FR-SHP-004, M5.34)', () => {
  it('FR-SHP-004: shadows and effects resolve with their colours, the first valid list winning', () => {
    const own = resolveStyle(
      {
        shadow: [
          { x: 4, y: 6, blur: 8, spread: 2, color: '{color.primary}' },
          { x: 0, y: 0, blur: 5, color: '#000000', inset: true },
        ],
        effects: [
          { type: 'glow', radius: 10, color: '#00ff00' },
          { type: 'blur', radius: 3 },
        ],
      },
      'shape',
      theme,
    );
    expect(own.style.shadows).toEqual([
      { x: 4, y: 6, blur: 8, spread: 2, color: 'var(--fx-color-primary)', inset: false },
      { x: 0, y: 0, blur: 5, spread: 0, color: '#000000', inset: true },
    ]);
    expect(own.style.effects).toEqual([
      { type: 'glow', radius: 10, color: '#00ff00' },
      { type: 'blur', radius: 3, color: 'currentColor' },
    ]);
    // none of its own: the theme's; nothing anywhere: none
    expect(resolveStyle(undefined, 'shape', theme).style.shadows).toEqual([{ x: 1, y: 2, blur: 3, spread: 0, color: '#111111', inset: false }]);
    expect(resolveStyle(undefined, 'shape', LIGHT_THEME).style).toMatchObject({ shadows: [], effects: [] });
    // an empty list is a list: no shadow, whatever the theme says
    expect(resolveStyle({ shadow: [] }, 'shape', theme).style.shadows).toEqual([]);
  });

  it('a list with an invalid entry falls through to the next layer; an unknown colour is reported', () => {
    for (const bad of [
      [{ x: 1, y: 1, blur: -1, color: '#000000' }],
      [{ x: 'a', y: 1, blur: 1, color: '#000000' }],
      [{ x: 1, y: Number.NaN, blur: 1, color: '#000000' }],
      [{ x: 1, y: 1, blur: 1, color: 'url(x)' }],
      [{ x: 1, y: 1, blur: 1 }],
      [null],
      'shadow',
    ])
      expect(resolveStyle({ shadow: bad as never }, 'shape', theme).style.shadows, JSON.stringify(bad)).toEqual([
        { x: 1, y: 2, blur: 3, spread: 0, color: '#111111', inset: false },
      ]);
    for (const bad of [
      [{ type: 'shine', radius: 1 }],
      [{ type: 'blur', radius: -1 }],
      [{ type: 'glow', radius: 'x' }],
      [{ type: 'glow', radius: 1, color: 'x;y' }],
      [7],
    ])
      expect(resolveStyle({ effects: bad as never }, 'shape', theme).style.effects, JSON.stringify(bad)).toEqual([]);
    const r = resolveStyle({ shadow: [{ x: 1, y: 1, blur: 1, color: '{color.nope}' }] }, 'shape', LIGHT_THEME, ['records', 'e', 'style']);
    expect(r.style.shadows).toEqual([]);
    expect(r.diagnostics.map((d) => `${d.code} ${d.path}`)).toEqual(['FLX_TOKEN_UNKNOWN /records/e/style/shadow/0/color']);
    // a spread that is not a number is 0
    expect(resolveStyle({ shadow: [{ x: 0, y: 0, blur: 0, spread: 'x', color: '#000000' }] as never }, 'shape', theme).style.shadows[0]?.spread).toBe(0);
  });
});
