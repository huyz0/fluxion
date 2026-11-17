import type { Style } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { resolveStyle } from './resolve-style.js';
import type { Theme } from './tokens.js';
import { validateTheme } from './validate-theme.js';
import { BUILTIN_VARIANTS } from './variants.js';

const css = (token: string) => ({ type: 'color', css: `var(--fx-${token.replaceAll('.', '-')})` });
const NAMES = ['primary', 'subtle', 'outline', 'emphasis'];

describe('variants and per-definition defaults (FR-THM-006, ADR-0055)', () => {
  it('FR-THM-006: a variant reference resolves by kind', () => {
    const shape = resolveStyle({ variant: 'emphasis' }, 'shape', LIGHT_THEME).style;
    expect([shape.fill, shape.stroke.color, shape.stroke.width, shape.font.color, shape.font.weight]).toEqual([
      css('color.secondary'),
      'var(--fx-color-secondary)',
      'var(--fx-stroke-thick)',
      'var(--fx-color-background)',
      '700',
    ]);
    const connector = resolveStyle({ variant: 'emphasis' }, 'connector', LIGHT_THEME).style;
    expect([connector.stroke.color, connector.stroke.width]).toEqual(['var(--fx-color-secondary)', 'var(--fx-stroke-thick)']);
    expect(resolveStyle({ variant: 'outline' }, 'connector', LIGHT_THEME).style.stroke.dash).toBe('6 4');
    // a field the variant leaves unset falls back to the kind's defaults: primary sets no stroke width, so shapes and
    // connectors keep the regular one, and a shape keeps its radius
    const primary = resolveStyle({ variant: 'primary' }, 'shape', LIGHT_THEME).style;
    expect([primary.stroke.width, primary.radius]).toEqual(['var(--fx-stroke-regular)', 'var(--fx-radius-none)']);
    expect(resolveStyle({ variant: 'primary' }, 'connector', LIGHT_THEME).style.stroke.width).toBe('var(--fx-stroke-regular)');
    const text = resolveStyle({ variant: 'emphasis' }, 'text', LIGHT_THEME).style;
    expect([text.font.color, text.font.weight]).toEqual(['var(--fx-color-text)', '700']);
    expect(resolveStyle({ variant: 'outline' }, 'text', LIGHT_THEME).style.font.color).toBe('var(--fx-color-primary)');
    // the same name means the theme's style for each kind: a frame is boxed like a shape
    expect(resolveStyle({ variant: 'primary' }, 'frame', LIGHT_THEME).style.fill).toEqual(css('color.primary'));
  });

  it('FR-THM-006: a shape definition default applies to its shapes', () => {
    const theme: Theme = { ...LIGHT_THEME, defaults: { ...LIGHT_THEME.defaults, 'flowchart:decision': { fill: '{color.warning}', radius: 6 } } };
    const decision = resolveStyle(undefined, { kind: 'shape', defId: 'flowchart:decision' }, theme).style;
    expect([decision.fill, decision.radius]).toEqual([css('color.warning'), '6px']);
    // another definition, or no definition id, keeps the kind's defaults
    expect(resolveStyle(undefined, { kind: 'shape', defId: 'flowchart:process' }, theme).style.fill).toEqual(css('color.surface'));
    expect(resolveStyle(undefined, 'shape', theme).style.fill).toEqual(css('color.surface'));
    // the element's own value still wins
    expect(resolveStyle({ fill: '#123456' }, { kind: 'shape', defId: 'flowchart:decision' }, theme).style.fill).toEqual({ type: 'color', css: '#123456' });
  });

  it('FR-THM-006: the eight layers resolve in order, the first valid value winning per field', () => {
    // each layer sets the radius and a field no earlier layer sets, so removing the winner shows the next one
    const layers = {
      defIdVariant: { radius: 1, opacity: 0.1 },
      kindVariant: { radius: 2, opacity: 0.2 },
      defId: { radius: 3, opacity: 0.3 },
      definition: { radius: 4, opacity: 0.4 },
      kind: { radius: 5, opacity: 0.5 },
      star: { radius: 6, opacity: 0.6 },
    } as const;
    const build = (drop: ReadonlySet<string>) => {
      const keep = <T>(name: string, v: T) => (drop.has(name) ? {} : v);
      const theme: Theme = {
        ...LIGHT_THEME,
        defaults: {
          'my:def': { ...keep('defId', layers.defId), variants: keep('defIdVariant', { loud: layers.defIdVariant }) },
          shape: { ...keep('kind', layers.kind), variants: keep('kindVariant', { loud: layers.kindVariant }) },
          '*': keep('star', layers.star),
        },
      };
      const definition: Style = drop.has('definition') ? {} : layers.definition;
      return resolveStyle({ variant: 'loud' }, { kind: 'shape', defId: 'my:def', defaults: definition }, theme).style;
    };
    const order = ['defIdVariant', 'kindVariant', 'defId', 'definition', 'kind', 'star'] as const;
    const dropped = new Set<string>();
    for (const name of order) {
      const r = build(dropped);
      expect([r.radius, r.opacity], `${name} wins once the layers before it are gone`).toEqual([`${layers[name].radius}px`, String(layers[name].opacity)]);
      dropped.add(name);
    }
    // and with every theme layer gone, the built-in fallback
    expect(build(dropped).opacity).toBe('1');
    // the element's own value beats all of them
    expect(resolveStyle({ variant: 'loud', radius: 9 }, { kind: 'shape', defId: 'my:def', defaults: layers.definition }, LIGHT_THEME).style.radius).toBe('9px');
  });

  it("FR-THM-006: the definition's variant applies when the element names none; an unknown variant falls through", () => {
    const viaDefinition = resolveStyle(undefined, { kind: 'shape', defaults: { variant: 'emphasis' } }, LIGHT_THEME).style;
    expect(viaDefinition.fill).toEqual(css('color.secondary'));
    const unknown = resolveStyle({ variant: 'nonesuch' }, 'shape', LIGHT_THEME);
    expect(unknown.style.fill).toEqual(css('color.surface'));
    expect(unknown.diagnostics).toEqual([]);
  });

  it('FR-THM-006: the light theme ships the four variants for every kind that takes them, as token refs only', () => {
    for (const kind of ['shape', 'frame', 'connector', 'text']) {
      const variants = LIGHT_THEME.defaults?.[kind]?.['variants'] as Record<string, Style>;
      expect(Object.keys(variants), kind).toEqual(NAMES);
      expect(variants).toBe(BUILTIN_VARIANTS[kind]);
    }
    // every colour and dimension a variant sets is a token ref (or transparent), so a theme edit restyles it through CSS variables
    const leaves = (v: unknown): unknown[] => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.values(v).flatMap(leaves) : [v]);
    const strings = Object.values(BUILTIN_VARIANTS)
      .flatMap((byName) => Object.values(byName).flatMap(leaves))
      .filter((v) => typeof v === 'string');
    expect(strings.filter((v) => !/^\{[a-z.-]+\}$/.test(v as string) && v !== 'transparent')).toEqual([]);
    expect(validateTheme(LIGHT_THEME)).toEqual([]);
  });

  it('FR-THM-006: a variants entry that is not an object is a theme problem', () => {
    const theme = (defaults: NonNullable<Theme['defaults']>): Theme => ({ ...LIGHT_THEME, defaults });
    expect(validateTheme(theme({ shape: { variants: 'loud' } }))).toEqual([
      { code: 'THEME_INVALID', path: '/defaults/shape/variants', message: 'defaults.shape.variants is not an object' },
    ]);
    expect(validateTheme(theme({ shape: { variants: { loud: 3, quiet: {} } }, text: { variants: { x: [] } } }))).toEqual([
      { code: 'THEME_INVALID', path: '/defaults/shape/variants/loud', message: 'variant loud of defaults.shape is not a style object' },
      { code: 'THEME_INVALID', path: '/defaults/text/variants/x', message: 'variant x of defaults.text is not a style object' },
    ]);
  });
});
