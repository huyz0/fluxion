// FR-THM-005 (ADR-0055): role assignment from 1-3 seeds, determinism, PALETTE_INPUT on bad input, the contrast repair and its bounds,
// shuffle over the hue slots, locks, and applyPalette writing the role tokens.
import { describe, expect, it } from 'vitest';
import { PALETTE_CONTRAST_PAIRS, PALETTE_ROLES, solveLightness } from './contrast.js';
import { LIGHT_THEME } from './light.js';
import { contrastRatio, oklabDistance, oklchToCss, parseColor } from './oklch.js';
import { applyPalette, generatePalette, type Palette, type PaletteOptions } from './palette.js';
import { createRng } from './rng.js';
import type { Theme } from './tokens.js';
import { REQUIRED_COLOR_ROLES, validateTheme } from './validate-theme.js';

const gen = (options: PaletteOptions): Palette => {
  const result = generatePalette(options);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const code = (options: PaletteOptions): string => {
  const result = generatePalette(options);
  return result.ok ? 'ok' : result.error.code;
};
const lch = (hex: string) => parseColor(hex) as NonNullable<ReturnType<typeof parseColor>>;
const HUE_SLOTS = ['secondary', 'accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6'] as const;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('generatePalette roles (FR-THM-005)', () => {
  it('FR-THM-005: the roles are the 17 required colour roles, solved in an order where each pair names an earlier role', () => {
    expect([...PALETTE_ROLES].sort()).toEqual([...REQUIRED_COLOR_ROLES].sort());
    for (const { role, against } of PALETTE_CONTRAST_PAIRS) expect(PALETTE_ROLES.indexOf(against)).toBeLessThan(PALETTE_ROLES.indexOf(role));
  });

  it('FR-THM-005: seed 1 is primary, seeds 2 and 3 are secondary and accent-1, when they need no repair', () => {
    const out = gen({ seeds: ['#1d4ed8', '#6d28d9', '#0891b2'] });
    expect(out.colors.primary).toBe('#1d4ed8');
    expect(out.colors.secondary).toBe('#6d28d9');
    expect(out.colors['accent-1']).toBe('#0891b2');
    for (const r of ['primary', 'secondary', 'accent-1'] as const) expect(out.adjusted).not.toContain(r);
    expect(out.unmet).toEqual([]);
  });

  it('FR-THM-005: one seed fills the other hue slots at golden-angle hues from it, the neutrals on its hue, the status roles on fixed hues', () => {
    const out = gen({ seeds: ['#2563eb'] });
    const h1 = lch('#2563eb').h;
    HUE_SLOTS.forEach((slot, k) => {
      if (out.adjusted.includes(slot)) return;
      expect(hueGap(lch(out.colors[slot]).h, (h1 + 137.5 * (k + 1)) % 360), slot).toBeLessThan(3);
    });
    expect(lch(out.colors.background).l).toBeCloseTo(0.99, 2);
    expect(lch(out.colors.surface).l).toBeCloseTo(0.97, 2);
    expect(lch(out.colors.text).l).toBeCloseTo(0.22, 2);
    expect(hueGap(lch(out.colors.surface).h, h1)).toBeLessThan(15);
    for (const [r, h] of [
      ['success', 145],
      ['warning', 70],
      ['danger', 25],
      ['info', 240],
    ] as const)
      expect(hueGap(lch(out.colors[r]).h, h), r).toBeLessThan(4);
  });

  it('FR-THM-005: a seed too light for text on the background is darkened and listed in adjusted, keeping its hue', () => {
    const out = gen({ seeds: ['#facc15'] });
    expect(out.colors.primary).not.toBe('#facc15');
    expect(out.adjusted).toContain('primary');
    expect(contrastRatio(out.colors.primary, out.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(out.colors.primary, out.colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(hueGap(lch(out.colors.primary).h, lch('#facc15').h)).toBeLessThan(8);
    expect(lch(out.colors.primary).l).toBeLessThan(lch('#facc15').l);
  });

  it('FR-THM-005: seeds in other CSS forms are read, alpha ignored', () => {
    expect(gen({ seeds: ['rgb(29 78 216 / 0.5)'] }).colors.primary).toBe('#1d4ed8');
    expect(gen({ seeds: ['hsl(0 0% 20%)', 'oklch(0.5 0.1 200)'] }).unmet).toEqual([]);
  });
});

describe('generatePalette determinism and input (FR-THM-005)', () => {
  it('FR-THM-005: the same seeds, locks and shuffle give the same palette', () => {
    const options: PaletteOptions = { seeds: ['#ff0000', '#00ff00'], locks: { 'accent-3': '#123456' }, shuffle: 42 };
    expect(generatePalette(options)).toEqual(generatePalette(options));
    expect(JSON.stringify(gen(options))).toBe(JSON.stringify(gen({ ...options })));
  });

  it('FR-THM-005: no seed, four seeds, an unreadable colour, a bad lock or a bad shuffle is PALETTE_INPUT', () => {
    expect(code({ seeds: [] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['#111111', '#222222', '#333333', '#444444'] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['rebeccapurple'] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['#12'] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: [42 as unknown as string] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: '#123456' as unknown as string[] })).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['#123456'], locks: { primary: 'nope' } })).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['#123456'], locks: { brand: '#ffffff' } as never })).toBe('PALETTE_INPUT');
    for (const shuffle of [-1, 1.5, 2 ** 32, Number.NaN]) expect(code({ seeds: ['#123456'], shuffle }), String(shuffle)).toBe('PALETTE_INPUT');
    expect(code({ seeds: ['#123456'], shuffle: 2 ** 32 - 1 })).toBe('ok');
  });
});

describe('shuffle and locks (FR-THM-005)', () => {
  it('FR-THM-005: shuffle 0 is the canonical palette; another shuffle permutes only the hue slots', () => {
    const seeds = ['#2563eb'];
    expect(gen({ seeds, shuffle: 0 })).toEqual(gen({ seeds }));
    const base = gen({ seeds });
    const moved = [1, 2, 3, 4, 5].map((shuffle) => gen({ seeds, shuffle }));
    expect(moved.some((p) => HUE_SLOTS.some((s) => p.colors[s] !== base.colors[s]))).toBe(true);
    for (const p of moved)
      for (const r of PALETTE_ROLES.filter((x) => !(HUE_SLOTS as readonly string[]).includes(x))) expect(p.colors[r], r).toBe(base.colors[r]);
  });

  it('FR-THM-005: a locked colour is kept verbatim (lower-cased hex), is never repaired and anchors its unlocked partners', () => {
    const out = gen({ seeds: ['#2563eb'], locks: { background: '#0B1020', primary: '#FFFF00' } });
    expect(out.colors.background).toBe('#0b1020');
    expect(out.colors.primary).toBe('#ffff00');
    expect(out.adjusted).not.toContain('background');
    // text, solved against the locked dark background, goes light
    expect(contrastRatio(out.colors.text, out.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(lch(out.colors.text).l).toBeGreaterThan(0.5);
  });

  it('FR-THM-005: a lock anchors the unlocked roles solved before it as well as after (review r1 F1)', () => {
    for (const locks of [{ text: '#ffffff' }, { surface: '#101010' }, { primary: '#ffffff' }, { 'accent-1': '#000000' }] as const) {
      const out = gen({ seeds: ['#2563eb'], locks });
      const [role, colour] = Object.entries(locks)[0] as [keyof typeof out.colors, string];
      expect(out.colors[role], role).toBe(colour);
      expect(out.unmet, role).toEqual([]);
    }
    // a white text lock darkens the background it is read on
    expect(lch(gen({ seeds: ['#2563eb'], locks: { text: '#ffffff' } }).colors.background).l).toBeLessThan(0.6);
  });

  it('FR-THM-005: without misses on the light neutrals the inverted ones are not used', () => {
    const out = gen({ seeds: ['#2563eb'], locks: { text: '#000000' } });
    expect(lch(out.colors.background).l).toBeCloseTo(0.99, 2);
  });

  it('FR-THM-005: a light lock no longer drags the background to grey and every fill to black (review r2 F1)', () => {
    const FILLS = [...HUE_SLOTS, 'success', 'warning', 'danger', 'info'] as const;
    for (const locks of [{ primary: '#facc15' }, { text: '#ffffff' }, { secondary: '#fde047' }] as const) {
      const out = gen({ seeds: ['#22c55e', '#f97316'], locks });
      const name = JSON.stringify(locks);
      expect(out.unmet, name).toEqual([]);
      expect(new Set(FILLS.map((f) => out.colors[f])).size, name).toBe(FILLS.length);
      for (const [i, f] of FILLS.entries())
        for (const g of FILLS.slice(i + 1)) expect(oklabDistance(lch(out.colors[f]), lch(out.colors[g])), `${name} ${f}/${g}`).toBeGreaterThanOrEqual(0.02);
      // the inverted neutrals win: a dark background, not mid grey
      expect(lch(out.colors.background).l, name).toBeLessThan(0.3);
    }
  });

  it('FR-THM-005: a lock that leaves fills only one colour gives them that colour, met exactly, rather than a miss', () => {
    // a magenta background (Y ~ 0.10) under light text: only black reaches 3:1 on it and stays under the text
    const out = gen({ seeds: ['#4fe97a'], locks: { background: '#a20299' } });
    expect(out.unmet).toEqual([]);
    expect(out.colors['accent-1']).toBe('#000000');
    expect(contrastRatio('#000000', '#a20299')).toBeGreaterThanOrEqual(3);
  });

  it('FR-THM-005: a locked hue slot keeps its position through shuffle', () => {
    for (const shuffle of [1, 7, 99, 123456]) {
      const out = gen({ seeds: ['#2563eb'], locks: { 'accent-2': '#00aa00' }, shuffle });
      expect(out.colors['accent-2']).toBe('#00aa00');
    }
  });

  it('FR-THM-005: a constraint that locks make impossible yields the closest colour and a ContrastMiss, never a throw', () => {
    // text locked mid-grey: no accent can be 3:1 against white and 4.5:1 against it
    const out = gen({ seeds: ['#2563eb'], locks: { background: '#ffffff', text: '#595959' } });
    expect(out.unmet.length).toBeGreaterThan(0);
    for (const miss of out.unmet) {
      expect(miss.ratio).toBeLessThan(miss.target);
      expect(miss.ratio).toBeCloseTo(contrastRatio(out.colors[miss.role], out.colors[miss.against]) as number, 9);
    }
    expect(out.unmet.some((m) => m.role === 'accent-1' && m.against === 'text')).toBe(true);
    for (const r of PALETTE_ROLES) expect(out.colors[r]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('the lightness solver (FR-THM-005)', () => {
  const anchor = (hex: string, target: number) => ({ hex, target });

  it('FR-THM-005: a colour already feasible is not moved; one that is not moves to the nearest feasible lightness', () => {
    const blue = lch('#1d4ed8');
    expect(solveLightness(blue, [anchor('#ffffff', 4.5)]).hex).toBe('#1d4ed8');
    const yellow = lch('#facc15');
    const fixed = solveLightness(yellow, [anchor('#ffffff', 4.5)]);
    expect(fixed.met).toBe(true);
    expect(contrastRatio(fixed.hex, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // nearest: a little darker would fail, so the solver stopped near the boundary (target + 0.02 margin)
    expect(contrastRatio(fixed.hex, '#ffffff')).toBeLessThan(4.7);
  });

  it('FR-THM-005: over a sweep of colours and anchors the solver stays in [0, 1], nudges at most 8 times and meets every feasible target', () => {
    const rng = createRng(2055);
    for (let i = 0; i < 400; i++) {
      const color = { l: rng(), c: rng() * 0.3, h: rng() * 360, alpha: 1 };
      const grey = Math.round(rng() * 255)
        .toString(16)
        .padStart(2, '0');
      const target = rng() < 0.5 ? 4.5 : 3;
      const out = solveLightness(color, [anchor(`#${grey}${grey}${grey}`, target)]);
      expect(out.l).toBeGreaterThanOrEqual(0);
      expect(out.l).toBeLessThanOrEqual(1);
      expect(out.nudges).toBeLessThanOrEqual(8);
      expect(out.met).toBe(true);
      expect(contrastRatio(out.hex, `#${grey}${grey}${grey}`)).toBeGreaterThanOrEqual(target);
    }
  });

  it('FR-THM-005: an empty intersection reports met false and still returns a colour', () => {
    const out = solveLightness(lch('#2563eb'), [anchor('#ffffff', 3), anchor('#595959', 4.5)]);
    expect(out.met).toBe(false);
    expect(out.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.nudges).toBeLessThanOrEqual(8);
    // the closest: it meets one of the two
    expect(Math.max((contrastRatio(out.hex, '#ffffff') as number) / 3, (contrastRatio(out.hex, '#595959') as number) / 4.5)).toBeGreaterThanOrEqual(1);
  });
});

describe('the seeded stream (ADR-0055 copies ADR-0034)', () => {
  it('FR-THM-005: gives the same known answers as layout’s sfc32', () => {
    expect(Array.from({ length: 4 }, createRng(12345))).toEqual([0.498803693568334, 0.7180248491931707, 0.46510869706980884, 0.727176858112216]);
  });
});

describe('applyPalette (FR-THM-005)', () => {
  it('FR-THM-005: writes the 17 role tokens as literals, keeping $description, and the theme stays valid', () => {
    const out = gen({ seeds: ['#e11d48'] });
    const theme: Theme = {
      ...LIGHT_THEME,
      tokens: {
        ...LIGHT_THEME.tokens,
        color: {
          ...(LIGHT_THEME.tokens['color'] as object),
          primary: { $type: 'color', $value: '#000000', $description: 'brand' },
          secondary: { $type: 'color', $value: '{color.primary}', $extensions: { 'dev.fluxion': { transform: [{ lighten: 0.2 }] }, other: 1 } },
        },
      },
    };
    const applied = applyPalette(theme, out);
    const color = applied.tokens['color'] as Record<string, { $value: string; $description?: string; $extensions?: unknown }>;
    for (const r of PALETTE_ROLES) expect(color[r]?.$value, r).toBe(out.colors[r]);
    expect(color['primary']?.$description).toBe('brand');
    expect(color['secondary']?.$extensions).toEqual({ other: 1 });
    expect(validateTheme(applied)).toEqual([]);
    expect(applied.tokens['space']).toBe(LIGHT_THEME.tokens['space']);
    expect(oklchToCss(lch(color['primary']?.$value as string))).toBe(out.colors.primary);
  });
});
