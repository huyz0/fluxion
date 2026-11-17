import { describe, expect, it } from 'vitest';
import { exportDtcg, importDtcg, themeFileName, themesFromFiles } from './dtcg.js';
import { LIGHT_THEME } from './light.js';
import type { Theme, Token, TokenGroup } from './tokens.js';

/** The file `theme` exports to, through JSON text as a saved file would be. */
const saved = (theme: Theme): unknown => JSON.parse(JSON.stringify(exportDtcg(theme).file));

/** `LIGHT_THEME` with `tokens.color` changed by `colors`. */
const withColors = (colors: TokenGroup, name = 'custom'): Theme => ({
  ...LIGHT_THEME,
  name,
  tokens: { ...LIGHT_THEME.tokens, color: { ...(LIGHT_THEME.tokens['color'] as TokenGroup), ...colors } },
});
// biome-ignore lint/suspicious/noExplicitAny: a theme file is walked by path in these assertions
type Dict = any;
const color = ($value: string, extra: object = {}): Token => ({ $type: 'color', $value, ...extra }) as Token;

describe('theme files (FR-THM-007)', () => {
  it('FR-THM-007: an exported theme file re-imports deep-equal', () => {
    // the built-in default, and a theme without defaults or table styles (the themes-core pack's eight: its own test, through the SDK)
    const bare: Theme = { name: 'bare', tokens: LIGHT_THEME.tokens };
    for (const theme of [LIGHT_THEME, bare]) {
      const { file, warnings } = exportDtcg(theme);
      expect(warnings, theme.name).toEqual([]);
      const read = importDtcg(JSON.parse(JSON.stringify(file)));
      expect(read.ok && read.value.warnings, theme.name).toEqual([]);
      expect(read.ok && read.value.theme, theme.name).toEqual(theme);
    }
  });

  it('FR-THM-007: the file is DTCG: colour objects, px shadow lengths, the theme entry at the root', () => {
    const file = exportDtcg(LIGHT_THEME).file as Dict;
    expect(file.$extensions['dev.fluxion']).toEqual({ version: 1, name: 'light', defaults: LIGHT_THEME.defaults, tableStyles: LIGHT_THEME.tableStyles });
    const primary = (LIGHT_THEME.tokens['color'] as Record<string, { $value: string }>)['primary']?.$value as string;
    expect(file.color.primary.$value).toMatchObject({ colorSpace: 'srgb', alpha: 1, hex: primary.toLowerCase() });
    expect(file.color.primary.$value.components).toHaveLength(3);
    expect(file.shadow.md.$value.offsetY).toEqual({ value: 4, unit: 'px' });
    expect(file.shadow.md.$value.color.colorSpace).toBe('srgb');
    expect(file.motion.duration.fast).toEqual({ $type: 'duration', $value: { value: 120, unit: 'ms' } });
  });

  it('FR-THM-007: other colour forms survive the round trip, keeping their own text and extensions', () => {
    const theme = withColors({
      accent: color('#ABC'),
      tint: color('rgb(10 20 30 / 0.5)'),
      named: color('rebeccapurple', { $description: 'a named one' }),
      clear: color('transparent'),
      glass: color('#11223380'),
      ok: color('oklch(0.62 0.14 145)'),
      lab: color('oklab(0.5 0.1 -0.1 / 0.25)'),
      hsl: color('hsl(221 83% 53%)', { $extensions: { 'other.tool': { keep: true } } }),
    });
    const file = saved(theme) as Dict;
    expect(file.color.named.$value.hex).toBe('#663399');
    expect(file.color.named.$extensions['dev.fluxion'].css).toBe('rebeccapurple');
    expect(file.color.glass.$value).toMatchObject({ hex: '#112233', alpha: 0.502 });
    expect(file.color.glass.$extensions).toBeUndefined();
    expect(file.color.ok.$value).toMatchObject({ colorSpace: 'oklch', components: [0.62, 0.14, 145] });
    expect(file.color.lab.$value.colorSpace).toBe('oklab');
    expect(file.color.hsl.$extensions['other.tool']).toEqual({ keep: true });
    const read = importDtcg(file);
    expect(read.ok && read.value.theme).toEqual(theme);
  });

  it('FR-THM-007: a currentcolor token is left out with a warning', () => {
    const { file, warnings } = exportDtcg(withColors({ follow: color('currentcolor') }));
    expect(warnings).toEqual([expect.objectContaining({ code: 'DTCG_UNSUPPORTED', path: 'color.follow' })]);
    expect((file as Dict).color.follow).toBeUndefined();
  });

  it('FR-THM-007: a file that is not a Fluxion theme file, or is broken, is DTCG_INVALID', () => {
    const good = saved(LIGHT_THEME) as Dict;
    const cases: unknown[] = [
      null,
      [],
      { color: {} },
      { ...good, $extensions: { 'dev.fluxion': { ...good.$extensions['dev.fluxion'], version: 2 } } },
      { ...good, $extensions: { 'dev.fluxion': { version: 1 } } },
      { ...good, color: { ...good.color, primary: { $type: 'color', $value: { colorSpace: 'display-p3', components: [1, 0, 0] } } } },
      { ...good, color: { ...good.color, primary: 7 } },
      { ...good, shadow: { ...good.shadow, md: { $type: 'shadow', $value: { ...good.shadow.md.$value, blur: { value: 1, unit: 'rem' } } } } },
      // valid DTCG, but the theme lacks a required role
      { ...good, color: { ...good.color, primary: undefined } },
    ];
    for (const json of cases) {
      const read = importDtcg(JSON.parse(JSON.stringify(json)));
      expect(read.ok ? 'ok' : read.error.code, JSON.stringify(json)?.slice(0, 80)).toBe('DTCG_INVALID');
    }
  });

  it('FR-THM-007: a theme file is named after its theme', () => {
    expect(themeFileName({ name: 'High Contrast!' })).toBe('high-contrast.tokens.json');
    expect(themeFileName({ name: '***' })).toBe('theme.tokens.json');
  });

  it('FR-THM-007: a theme pack registers its themes', () => {
    const ocean = withColors({ primary: color('#0b6e99') }, 'Ocean');
    const forest = withColors({ primary: color('#2f7d3b') }, 'forest');
    const themes = themesFromFiles('acme', [saved(ocean), saved(forest)]);
    expect(themes.ok && themes.value.map((t) => t.id)).toEqual(['acme:ocean', 'acme:forest']);
    expect(themes.ok && themes.value[0]).toEqual({ ...ocean, id: 'acme:ocean' });
    // all or nothing: a broken file, or two files giving one theme, refuse the pack's themes and name the file
    const broken = themesFromFiles('acme', [saved(ocean), { color: {} }]);
    expect(broken.ok ? '' : broken.error).toEqual({ code: 'DTCG_INVALID', message: expect.stringContaining('theme file 1') });
    const twice = themesFromFiles('acme', [saved(ocean), saved(withColors({}, 'OCEAN'))]);
    expect(twice.ok ? '' : twice.error.message).toContain('acme:ocean');
  });
});
