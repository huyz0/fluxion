import { describe, expect, it } from 'vitest';
import { BUILTIN_TABLE_STYLES, LIGHT_THEME, resolveStyle, themeOf, themeSchema } from './index.js';

describe('table styles (FR-SHP-014, ADR-0054)', () => {
  it('FR-SHP-014: the light theme ships plain, banded and grid, each part resolving with no unknown token', () => {
    expect(Object.keys(LIGHT_THEME.tableStyles ?? {})).toEqual(['plain', 'banded', 'grid']);
    for (const [name, style] of Object.entries(BUILTIN_TABLE_STYLES))
      for (const [part, fragment] of Object.entries(style)) {
        const r = resolveStyle(fragment, 'table', LIGHT_THEME, [name, part]);
        expect(r.diagnostics, `${name}.${part}`).toEqual([]);
      }
  });

  it('FR-SHP-014: themeOf and the theme schema keep a theme’s table styles; a malformed list is left out of themeOf', () => {
    const tableStyles = { banded: { header: { fill: '#ff0000' } } };
    expect(themeOf({ name: 't', tokens: LIGHT_THEME.tokens, tableStyles })?.tableStyles).toEqual(tableStyles);
    expect(themeOf({ name: 't', tokens: LIGHT_THEME.tokens, tableStyles: { banded: 3 } })?.tableStyles).toBeUndefined();
    const parsed = themeSchema.safeParse({ name: 't', tokens: LIGHT_THEME.tokens, tableStyles });
    expect(parsed.success && parsed.data.tableStyles).toEqual(tableStyles);
  });
});
