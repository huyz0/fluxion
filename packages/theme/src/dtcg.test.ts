import { describe, expect, it } from 'vitest';
import canonical from './__fixtures__/canonical.tokens.json' with { type: 'json' };
import ramp from './__fixtures__/ramp.tokens.json' with { type: 'json' };
import { themeToCss } from './css-export.js';
import { exportDtcg, importDtcg } from './dtcg.js';
import type { DtcgWarning } from './dtcg-types.js';
import { LIGHT_THEME } from './light.js';
import { nodeAt, type Theme, type Token, tokenEntries } from './tokens.js';

/** The imported theme and its warnings, or a thrown failure. */
function imported(json: unknown, options: Parameters<typeof importDtcg>[1] = {}): { theme: Theme; warnings: readonly DtcgWarning[] } {
  const read = importDtcg(JSON.parse(JSON.stringify(json)), options);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}
const codes = (warnings: readonly DtcgWarning[], path: string): string[] => warnings.filter((w) => w.path === path).map((w) => w.code);
const tokenAt = (theme: Theme, path: string): Token | undefined => nodeAt(theme.tokens, path) as Token | undefined;
const lightColor = (role: string): unknown => tokenAt(LIGHT_THEME, `color.${role}`)?.$value;

/** Every token of a DTCG tree, with whether it carries its own `$type`. */
function typed(tree: object, prefix = ''): Array<[string, boolean]> {
  return Object.entries(tree).flatMap(([name, node]): Array<[string, boolean]> => {
    if (name.startsWith('$') || typeof node !== 'object' || node === null) return [];
    const path = prefix === '' ? name : `${prefix}.${name}`;
    return '$value' in node ? [[path, typeof (node as { $type?: unknown }).$type === 'string']] : typed(node, path);
  });
}

describe('DTCG import and export (FR-THM-009)', () => {
  it('FR-THM-009: the canonical DTCG fixture round-trips equal', () => {
    // canonical: every token typed, the root dev.fluxion entry, colours as export writes them
    expect(typed(canonical).every(([, own]) => own)).toBe(true);
    expect((canonical.$extensions as Record<string, unknown>)['dev.fluxion']).toMatchObject({ version: 1, name: 'fixture' });
    const { theme, warnings } = imported(canonical);
    expect(warnings).toEqual([]);
    expect(exportDtcg(theme)).toEqual({ file: canonical, warnings: [] });
    // the forms the fixture carries: an OKLCH colour, a named colour kept as text, a translucent hex, a derived colour
    expect(tokenAt(theme, 'color.brand')).toEqual({ $type: 'color', $description: 'a colour in OKLCH', $value: 'oklch(0.62 0.14 250)' });
    expect(tokenAt(theme, 'color.ink')?.$value).toBe('rebeccapurple');
    expect(tokenAt(theme, 'color.veil')?.$value).toBe('#0f172a80');
    expect(tokenAt(theme, 'color.hover')?.$extensions).toEqual({ 'dev.fluxion': { transform: [{ darken: 0.1 }] } });
  });

  it('FR-THM-009: a file without the Fluxion entry is read in one pass to a fixpoint', () => {
    // group $type, no extension: the first export is canonical, and importing it again changes nothing
    const plain = {
      color: { $type: 'color', primary: { $value: '#0b6e99' }, brand: { $value: { colorSpace: 'oklab', components: [0.5, 0.1, -0.1], alpha: 0.5 } } },
      motion: { duration: { $type: 'duration', fast: { $value: { value: 0.1, unit: 's' } } } },
      font: { weight: { $type: 'fontWeight', heavy: { $value: 'extra-black' }, body: { $value: 'regular' } } },
    };
    const first = exportDtcg(imported(plain, { fileName: 'dir/brand.tokens.json' }).theme).file;
    expect(typed(first).every(([, own]) => own)).toBe(true);
    expect(exportDtcg(imported(first).theme).file).toEqual(first);
    const theme = imported(plain).theme;
    expect(imported(plain, { fileName: 'dir/brand.tokens.json' }).theme.name).toBe('brand');
    expect(imported(plain, { name: 'Mine', fileName: 'x.json' }).theme.name).toBe('Mine');
    expect(theme.name).toBe('imported');
    expect(tokenAt(theme, 'color.primary')?.$value).toBe('#0b6e99');
    expect(tokenAt(theme, 'color.brand')?.$value).toBe('oklab(0.5 0.1 -0.1 / 0.5)');
    expect(tokenAt(theme, 'motion.duration.fast')?.$value).toEqual({ value: 100, unit: 'ms' });
    expect(tokenAt(theme, 'font.weight.heavy')?.$value).toBe(950);
    expect(tokenAt(theme, 'font.weight.body')?.$value).toBe(400);
    // what the file does not set comes from the base: the light theme's tokens, defaults and table styles
    expect(tokenAt(theme, 'color.surface')?.$value).toBe(lightColor('surface'));
    expect(theme.defaults).toEqual(LIGHT_THEME.defaults);
    expect(theme.tableStyles).toEqual(LIGHT_THEME.tableStyles);
  });

  it('FR-THM-009: a foreign ramp file imports with warnings and never fails', () => {
    const { theme, warnings } = imported(ramp, { fileName: 'tokens-studio.json' });
    // the ramp under the required token color.primary moves aside, and the role aliases its step 500
    expect(codes(warnings, 'color.primary')).toEqual(['DTCG_PATH_RENAMED', 'DTCG_ROLE_MAPPED']);
    expect(tokenAt(theme, 'color.primary')).toEqual({ $type: 'color', $value: '{color.primary-ramp.500}' });
    expect(tokenAt(theme, 'color.primary-ramp.100')?.$value).toBe('#dbeafe');
    // aliases into the moved ramp follow it; one to nothing is dropped
    expect(tokenAt(theme, 'color.link')?.$value).toBe('{color.primary-ramp.700}');
    expect(codes(warnings, 'color.visited')).toEqual(['DTCG_ALIAS_BROKEN']);
    expect(tokenAt(theme, 'color.visited')).toBeUndefined();
    // a mistyped token at a theme path and a new path in a typed group are dropped; the base keeps its own
    expect(codes(warnings, 'font.size.md')).toEqual(['DTCG_TYPE_MISMATCH']);
    expect(tokenAt(theme, 'font.size.md')).toEqual(tokenAt(LIGHT_THEME, 'font.size.md'));
    expect(codes(warnings, 'space.4')).toEqual(['DTCG_TYPE_MISMATCH']);
    // rem is read as 16 px, warned
    expect(tokenAt(theme, 'radius.card')?.$value).toEqual({ value: 8, unit: 'px' });
    expect(codes(warnings, 'radius.card')).toEqual(['DTCG_UNSUPPORTED']);
    // background maps from bg; a role the file has no name for keeps the base colour
    expect(tokenAt(theme, 'color.background')?.$value).toBe('{color.bg}');
    expect(codes(warnings, 'color.danger')).toEqual(['DTCG_ROLE_DEFAULTED']);
    expect(tokenAt(theme, 'color.danger')?.$value).toBe(lightColor('danger'));
    expect(theme.name).toBe('tokens-studio');
  });

  it('FR-THM-009: a foreign file without roles imports onto the base theme', () => {
    const { theme, warnings } = imported(
      { space: { $type: 'dimension', huge: { $value: { value: 96, unit: 'px' } } } },
      { base: { ...LIGHT_THEME, name: 'b' } },
    );
    expect(tokenAt(theme, 'space.huge')?.$value).toEqual({ value: 96, unit: 'px' });
    expect(tokenEntries(theme.tokens).length).toBe(tokenEntries(LIGHT_THEME.tokens).length + 1);
    expect(new Set(warnings.map((w) => w.code))).toEqual(new Set(['DTCG_ROLE_DEFAULTED']));
  });

  it('FR-THM-009: each unsupported construct is dropped with a warning naming its path', () => {
    const { theme, warnings } = imported({
      $description: 'root text',
      color: {
        $extensions: { 'tool.x': 1 },
        $type: 'color',
        p3: { $value: { colorSpace: 'display-p3', components: [1, 0, 0] } },
        old: { $value: '#123456', $deprecated: true },
        $root: { $value: '#000000' },
      },
      shadow: {
        $type: 'shadow',
        stack: { $value: [{}, {}] },
        soft: {
          $value: {
            color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.25 },
            offsetX: { value: 0, unit: 'px' },
            offsetY: { value: 2, unit: 'px' },
            blur: { value: 4, unit: 'px' },
            spread: { value: 0, unit: 'px' },
          },
        },
      },
      type: { heading: { $type: 'typography', $value: { fontFamily: 'Inter' } } },
      'bad name': { $type: 'color', $value: '#000000' },
      untyped: { $value: 3 },
      ref: { $value: '{deep.x}' },
      lost: { $value: '{nowhere}' },
      weight: { $type: 'fontWeight', a: { $value: 'Bold' } },
      glow: {
        $type: 'shadow',
        $value: {
          inset: true,
          color: '#000000',
          offsetX: { value: 0, unit: 'px' },
          offsetY: { value: 0, unit: 'px' },
          blur: { value: 1, unit: 'px' },
          spread: { value: 0, unit: 'px' },
        },
      },
      hue: { $type: 'color', $value: { colorSpace: 'oklch', components: [0.5, 0, 'none'] } },
      deep: { $extends: '{color}', x: { $type: 'number', $value: 1, $ref: '#/x' } },
    });
    for (const path of [
      '(root)',
      'color',
      'color.p3',
      'color.old',
      'shadow.stack',
      'type.heading',
      'bad name',
      'untyped',
      'deep',
      'deep.x',
      'weight.a',
      'glow',
    ])
      expect(codes(warnings, path), path).toContain('DTCG_UNSUPPORTED');
    expect(tokenAt(theme, 'color.p3')).toBeUndefined();
    expect(tokenAt(theme, 'color.old')?.$value).toBe('#123456');
    expect(tokenAt(theme, 'shadow.soft')?.$value).toEqual({ color: '#00000040', offsetX: 0, offsetY: 2, blur: 4, spread: 0 });
    expect(tokenAt(theme, 'deep.x')?.$value).toBe(1);
    // an untyped reference takes its target's type (and, not being a colour, its value); one to nothing is dropped
    expect(tokenAt(theme, 'ref')).toEqual({ $type: 'number', $value: 1 });
    expect(codes(warnings, 'lost')).toEqual(['DTCG_ALIAS_BROKEN']);
    expect(tokenAt(theme, 'hue')?.$value).toBe('oklch(0.5 0 0)');
  });

  it('FR-THM-009: shape, collisions and references: renames, the later of one CSS variable, broken and looping links', () => {
    const { theme, warnings } = imported({
      color: {
        $type: 'color',
        // a token where the base has a group, and a taken -ramp name
        'primary-ramp': { $value: '#111111' },
        primary: { a: { $value: '#222222' } },
        loop1: { $value: '{color.loop2}' },
        loop2: { $value: '{color.loop1}' },
        derived: { $value: '{color.primary.a}', $extensions: { 'dev.fluxion': { transform: [{ mix: { with: '{color.primary.a}', amount: 0.5 } }] } } },
        badstep: { $value: '#333333', $extensions: { 'dev.fluxion': { transform: [{ spin: 1 }] } } },
        'a-b': { $value: '#444444' },
        a: { b: { $value: '#555555' } },
      },
      font: { $type: 'dimension', size: { $value: { value: 1, unit: 'px' } } },
      space: { $type: 'number', two: { $value: '{space.one}' }, one: { $value: 2 } },
    });
    expect(tokenAt(theme, 'color.primary-ramp-2.a')?.$value).toBe('#222222');
    expect(codes(warnings, 'color.primary')).toContain('DTCG_PATH_RENAMED');
    expect(tokenAt(theme, 'font.size-value')?.$value).toEqual({ value: 1, unit: 'px' });
    expect(tokenAt(theme, 'color.derived')).toMatchObject({
      $value: '{color.primary-ramp-2.a}',
      $extensions: { 'dev.fluxion': { transform: [{ mix: { with: '{color.primary-ramp-2.a}', amount: 0.5 } }] } },
    });
    expect(codes(warnings, 'color.loop1')).toEqual(['DTCG_ALIAS_BROKEN']);
    expect(codes(warnings, 'color.loop2')).toEqual(['DTCG_ALIAS_BROKEN']);
    expect(codes(warnings, 'color.badstep')).toEqual(['DTCG_ALIAS_BROKEN']);
    expect(codes(warnings, 'color.a.b')).toEqual(['DTCG_UNSUPPORTED']);
    expect(tokenAt(theme, 'color.a-b')?.$value).toBe('#444444');
    // a non-colour alias is replaced by the value it reaches; space.* takes dimensions, so both are mistyped there
    expect(codes(warnings, 'space.two')).toEqual(['DTCG_TYPE_MISMATCH']);
  });

  it('FR-THM-009: a foreign colour that breaks over a base token restores the base token', () => {
    const { theme, warnings } = imported({ color: { $type: 'color', surface: { $value: '{color.nowhere}' }, text: { $value: '{color.text}' } } });
    expect(tokenAt(theme, 'color.surface')?.$value).toBe(lightColor('surface'));
    expect(codes(warnings, 'color.surface')).toEqual(['DTCG_ALIAS_BROKEN', 'DTCG_ROLE_DEFAULTED']);
    expect(codes(warnings, 'color.text')).toEqual(['DTCG_ALIAS_BROKEN', 'DTCG_ROLE_DEFAULTED']);
  });

  it('FR-THM-009: a role takes a numeric ramp median, a named ramp middle, or a role name', () => {
    const c = (hex: string) => ({ $value: hex });
    const { theme, warnings } = imported({
      color: {
        $type: 'color',
        secondary: { '50': c('#000001'), '200': c('#000002'), '1000': c('#000003'), '80': c('#000004') },
        brand: { light: c('#000005'), base: c('#000006'), dark: c('#000007') },
        // step 500 wins over the median (800 here)
        info: { '100': c('#00000a'), '500': c('#00000b'), '800': c('#00000c'), '900': c('#00000d'), '950': c('#00000e') },
        error: c('#000008'),
        foreground: { $type: 'number', $value: 1 },
        fg: c('#000009'),
      },
    });
    expect(tokenAt(theme, 'color.secondary')?.$value).toBe('{color.secondary-ramp.80}');
    expect(tokenAt(theme, 'color.info')?.$value).toBe('{color.info-ramp.500}');
    expect(tokenAt(theme, 'color.danger')?.$value).toBe('{color.error}');
    expect(tokenAt(theme, 'color.text')?.$value).toBe('{color.fg}');
    // primary has no ramp of its own: brand is a ramp of three, the middle one
    expect(tokenAt(theme, 'color.primary')?.$value).toBe('{color.brand.base}');
    expect(codes(warnings, 'color.primary')).toEqual(['DTCG_ROLE_MAPPED']);
  });

  it('FR-THM-009: a role candidate whose links return to the role is passed over, never a loop', () => {
    // background <- bg -> background; primary <- brand.a -> primary; text <- text-ramp.muted -> muted -> text-ramp.muted
    for (const color of [
      { bg: { $value: '{color.background}' } },
      { brand: { a: { $value: '{color.primary}' } } },
      { text: { muted: { $value: '{color.muted}' } } },
    ]) {
      const read = importDtcg({ color: { $type: 'color', ...color } });
      expect(read.ok, JSON.stringify(color)).toBe(true);
    }
    const { theme, warnings } = imported({ color: { $type: 'color', bg: { $value: '{color.background}' }, canvas: { $value: '#fafafa' } } });
    // bg loops, so the next candidate (canvas) is taken
    expect(tokenAt(theme, 'color.background')?.$value).toBe('{color.canvas}');
    expect(codes(warnings, 'color.background')).toEqual(['DTCG_ROLE_MAPPED']);
    const looped = imported({ color: { $type: 'color', bg: { $value: '{color.background}' } } });
    expect(tokenAt(looped.theme, 'color.background')?.$value).toBe(lightColor('background'));
    expect(codes(looped.warnings, 'color.background')).toEqual(['DTCG_ROLE_DEFAULTED']);
  });

  it('FR-THM-009: only input that is not a JSON object is DTCG_INVALID', () => {
    for (const json of [null, [], 'x', 3]) expect(importDtcg(json)).toMatchObject({ ok: false, error: { code: 'DTCG_INVALID' } });
    expect(importDtcg({}).ok).toBe(true);
  });

  it('FR-THM-009: the CSS-variable export matches its golden', async () => {
    const css = themeToCss(LIGHT_THEME);
    await expect(css).toMatchFileSnapshot('./__golden__/theme.css');
    expect(css.startsWith('/* theme: light */\n:root {\n  --fx-color-')).toBe(true);
    expect(css.endsWith(';\n}\n')).toBe(true);
    expect(themeToCss({ ...LIGHT_THEME, name: 'a */ b\nc' }, { selector: '.deck' })).toMatch(/^\/\* theme: a \* \/ b c \*\/\n\.deck \{\n/);
  });
});
