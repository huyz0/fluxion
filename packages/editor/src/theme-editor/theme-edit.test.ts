import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { contrastRatio, LIGHT_THEME, type Theme } from '@fluxion/theme';
import { describe, expect, it } from 'vitest';
import { colorOf, editedTheme, generated, themeWrite, variantPreviews, withColor } from './theme-edit.js';

function fresh() {
  const b = documentBuilder({ seed: 7 });
  const screen = b.screen();
  return { core: createCore(b.build()), screen };
}

const docRecord = (core: ReturnType<typeof createCore>) => core.store.get(core.store.members('byType', 'document')[0] as never) as { themeId?: string };

describe('theme editor model (M20.11)', () => {
  it('FR-THM-007: the first edit of a document with no theme record adopts the light theme in one undo step', () => {
    const { core, screen } = fresh();
    const before = editedTheme(core.store, screen);
    expect(before).toEqual({ theme: LIGHT_THEME, recordId: undefined, holder: core.store.members('byType', 'document')[0] });
    const depth = core.store.history.undoDepth;
    expect(core.execute('document.applyRecords', themeWrite(core.store, before, withColor(before.theme, 'primary', '#e11d48'))).ok).toBe(true);
    expect(core.store.history.undoDepth).toBe(depth + 1);
    expect(docRecord(core).themeId).toBe('theme-light');
    const after = editedTheme(core.store, screen);
    expect(after.recordId).toBe('theme-light');
    expect(colorOf(after.theme, 'primary')).toBe('#e11d48');
    // the next edit rewrites that record only, keeping the rest of the theme
    const next = themeWrite(core.store, after, withColor(after.theme, 'surface', '#fef3c7'));
    expect(next.puts.map((r) => r.id)).toEqual(['theme-light']);
    expect(core.execute('document.applyRecords', next).ok).toBe(true);
    const theme = editedTheme(core.store, screen).theme;
    expect([colorOf(theme, 'primary'), colorOf(theme, 'surface'), colorOf(theme, 'text')]).toEqual(['#e11d48', '#fef3c7', colorOf(LIGHT_THEME, 'text')]);
    expect(theme.defaults).toEqual(LIGHT_THEME.defaults);
    core.store.history.undo();
    core.store.history.undo();
    expect(docRecord(core).themeId).toBeUndefined();
  });

  it("FR-THM-007: the editor edits the open screen's own theme when it overrides the document's", () => {
    const { core, screen } = fresh();
    const { tokens, defaults } = LIGHT_THEME;
    expect(core.execute('screen.setThemeOverride', { id: screen, theme: { name: 'night', tokens, defaults } }).ok).toBe(true);
    expect(editedTheme(core.store, screen).recordId).toBe('theme-night');
    expect(editedTheme(core.store, undefined).recordId).toBeUndefined();
  });

  it("FR-THM-007: the editor edits the theme the renderer draws: a mastered screen's master theme, and no record overwritten", () => {
    const b = documentBuilder({ seed: 9 });
    const screen = b.screen();
    const masterId = b.screen();
    const core = createCore(b.build());
    const get = (id: string) => core.store.get(id as never) as unknown as Record<string, unknown>;
    const { tokens, defaults } = LIGHT_THEME;
    const dark = { id: 'theme-dark', type: 'theme', name: 'dark', tokens, defaults };
    const puts = [dark, { ...get(masterId), role: 'master', themeId: 'theme-dark' }, { ...get(screen), masterId }];
    expect(core.execute('document.applyRecords', { puts, deletes: [] }).ok).toBe(true);
    expect(core.execute('document.setTheme', { theme: { name: 'light', tokens, defaults } }).ok).toBe(true);
    // the screen names no theme: its master's is drawn, so it is the one edited
    const mastered = editedTheme(core.store, screen);
    expect(mastered).toMatchObject({ recordId: 'theme-dark', holder: masterId });
    expect(core.execute('document.applyRecords', themeWrite(core.store, mastered, withColor(mastered.theme, 'primary', '#e11d48'))).ok).toBe(true);
    expect(colorOf(editedTheme(core.store, screen).theme, 'primary')).toBe('#e11d48');
    expect(colorOf(editedTheme(core.store, masterId).theme, 'primary')).toBe('#e11d48');
    // a document with no theme while another screen's override holds `theme-light`: the edit adopts a record under a free id
    const b2 = documentBuilder({ seed: 10 });
    const first = b2.screen();
    const second = b2.screen();
    const core2 = createCore(b2.build());
    expect(core2.execute('screen.setThemeOverride', { id: second, theme: { name: 'light', tokens, defaults } }).ok).toBe(true);
    const adopted = editedTheme(core2.store, first);
    expect(adopted).toEqual({ theme: LIGHT_THEME, recordId: undefined, holder: core2.store.members('byType', 'document')[0] });
    const write = themeWrite(core2.store, adopted, withColor(adopted.theme, 'surface', '#fef3c7'));
    expect(write.puts.map((r) => r.id)).toEqual(['theme-light-2', adopted.holder]);
    expect(core2.execute('document.applyRecords', write).ok).toBe(true);
    expect(editedTheme(core2.store, first).recordId).toBe('theme-light-2');
    // the override's record is not touched
    expect(colorOf(editedTheme(core2.store, second).theme, 'surface')).toBe(colorOf(LIGHT_THEME, 'surface'));
  });

  it('FR-THM-007: a colour edit keeps the token description and turns an alias into a literal', () => {
    const theme: Theme = {
      ...LIGHT_THEME,
      tokens: {
        ...LIGHT_THEME.tokens,
        color: { ...(LIGHT_THEME.tokens['color'] as object), primary: { $type: 'color', $value: '{color.secondary}', $description: 'brand' } },
      },
    };
    expect(colorOf(theme, 'primary')).toBe(colorOf(LIGHT_THEME, 'secondary'));
    const edited = withColor(theme, 'primary', '#0f766e');
    expect((edited.tokens['color'] as Record<string, unknown>)['primary']).toEqual({ $type: 'color', $value: '#0f766e', $description: 'brand' });
    expect(colorOf(edited, 'primary')).toBe('#0f766e');
  });

  it('FR-THM-005: the palette generator applies a palette whose locked roles keep their colour and whose text pairs meet AA', () => {
    const locked = withColor(LIGHT_THEME, 'primary', '#7c3aed');
    const out = generated(locked, { seeds: ['#e11d48', ' '], locked: new Set(['primary']), shuffle: 3 });
    if ('error' in out) throw new Error(out.error);
    expect(colorOf(out.theme, 'primary')).toBe('#7c3aed');
    expect(contrastRatio(colorOf(out.theme, 'text'), colorOf(out.theme, 'background'))).toBeGreaterThanOrEqual(4.5);
    expect(colorOf(out.theme, 'secondary')).toBe(out.palette.colors.secondary);
    // a seed the generator cannot read is its message, not a theme
    expect(generated(LIGHT_THEME, { seeds: ['not a colour'], locked: new Set(), shuffle: 0 })).toEqual({ error: expect.any(String) });
  });

  it('FR-THM-006: the variant previews are the four built-in shape variants and those the theme adds, as the theme resolves them', () => {
    const previews = variantPreviews(LIGHT_THEME);
    expect(previews.map((p) => p.name)).toEqual(['primary', 'subtle', 'outline', 'emphasis']);
    const primary = previews[0];
    expect(primary?.fill).toMatch(/^var\(--fx-color-/);
    const shape = LIGHT_THEME.defaults?.['shape'] ?? {};
    const variants = { ...(shape['variants'] as object), loud: { fill: '#ff0000' } };
    const extended: Theme = { ...LIGHT_THEME, defaults: { ...LIGHT_THEME.defaults, shape: { ...shape, variants } } };
    expect(variantPreviews(extended).at(-1)).toMatchObject({ name: 'loud', fill: '#ff0000' });
  });
});
