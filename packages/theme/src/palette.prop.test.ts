// FR-THM-005 (ADR-0055): over random 1-3 seed colours, the generated palette assigns every role, every text pair of the contrast
// table is at least 4.5:1 and every graphic pair at least 3:1 on the emitted hex, nothing is unmet, and the same input gives the same
// palette; a locked role keeps its colour through any shuffle and a locked hue slot is never shuffled; with one lock, a pair with an
// unlocked side is met unless no lightness of that side can meet it, and a black or white lock leaves nothing unmet. Seed and run
// count come from tools/vitest/fast-check.setup.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTRAST_GRAPHIC, CONTRAST_TEXT, PALETTE_CONTRAST_PAIRS, PALETTE_ROLES, type PaletteRole } from './contrast.js';
import { contrastRatio, type Oklch, oklabDistance, parseColor, relativeLuminance } from './oklch.js';
import { generatePalette, type Palette } from './palette.js';

const HEX = /^#[0-9a-f]{6}$/;
const byte = fc.integer({ min: 0, max: 255 });
const hexColor = fc.tuple(byte, byte, byte).map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
const oklchColor = fc
  .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 0.4, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }))
  .map(([l, c, h]) => `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`);
const seedColor = fc.oneof(hexColor, oklchColor);
const seeds = fc.array(seedColor, { minLength: 1, maxLength: 3 });
const shuffle = fc.integer({ min: 0, max: 0xffffffff });
const role = fc.constantFrom(...PALETTE_ROLES);

const lch = (hex: string): Oklch => parseColor(hex) as Oklch;
const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const HUE_SLOTS = ['secondary', 'accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6'] as const;
const ratio = (y1: number, y2: number): number => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
/** Whether some luminance of `role` reaches every one of its pairs, with a margin, against the other roles' final colours. */
const fixable = (colors: Readonly<Record<PaletteRole, string>>, role: PaletteRole): boolean => {
  const partners = PALETTE_CONTRAST_PAIRS.flatMap((p) =>
    p.role === role ? [[p.against, p.target] as const] : p.against === role ? [[p.role, p.target] as const] : [],
  ).map(([other, target]) => [relativeLuminance(lch(colors[other])), target + 0.03] as const);
  for (let i = 0; i <= 4000; i++) if (partners.every(([y, t]) => ratio(i / 4000, y) >= t)) return true;
  return false;
};

/** With one seed and hue slot k locked to its canonical colour, no other slot carries slot k's golden-angle hue under shuffle n. */
function lockedSlotStays(seed: string, k: number, n: number): void {
  const slot = HUE_SLOTS[k] as PaletteRole;
  const canonical = palette(generatePalette({ seeds: [seed] }));
  // the generator's h1 is the parsed seed's hue (a grey oklch() keeps the hue it was written with; its hex reads back as 0)
  const own = (lch(seed).h + 137.5 * (k + 1)) % 360;
  const out = palette(generatePalette({ seeds: [seed], locks: { [slot]: canonical.colors[slot] }, shuffle: n }));
  expect(out.colors[slot]).toBe(canonical.colors[slot]);
  for (const other of HUE_SLOTS.filter((s) => s !== slot)) expect(hueGap(lch(out.colors[other]).h, own), other).toBeGreaterThan(10);
}

const FILLS = [...HUE_SLOTS, 'success', 'warning', 'danger', 'info'] as const;
/** The least OKLab distance two fills of a locked palette keep (about one just-noticeable difference). */
const MIN_FILL_DISTANCE = 0.02;
/**
 * How much mid lightness (OKLab L 0.25 to 0.9, where colours keep chroma) the fills may take: the width of the greys there that
 * are at least 3:1 on `background` and 4.5:1 under `text`. Distinct fills are asserted when it is at least 0.04: room for two fills
 * with no chroma to tell them apart (two equal grey seeds) to sit 0.02 apart in lightness inside the solver's contrast margin. With
 * less, a lock can leave the fills only near-black or near-white colours, where chroma collapses; in 40 000 random single locks every
 * palette whose fills came closer than 0.02 had at most 0.005 of mid band.
 */
const midBand = (colors: Readonly<Record<PaletteRole, string>>): number => {
  const [yb, yt] = [relativeLuminance(lch(colors.background)), relativeLuminance(lch(colors.text))];
  let width = 0;
  for (let i = 0; i < 1000; i++) {
    const l = (i + 0.5) / 1000;
    // a grey's luminance is its OKLab lightness cubed
    if (l >= 0.25 && l <= 0.9 && ratio(l ** 3, yb) >= CONTRAST_GRAPHIC && ratio(l ** 3, yt) >= CONTRAST_TEXT) width += 0.001;
  }
  return width;
};
const ROOMY = 0.04;
const oneLock = fc.tuple(seeds, role, hexColor, shuffle);
const lockedPalette = ([given, locked, colour, n]: [string[], PaletteRole, string, number]): Palette =>
  palette(generatePalette({ seeds: given, locks: { [locked]: colour }, shuffle: n }));

const palette = (result: ReturnType<typeof generatePalette>): Palette => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

describe('palette from seed colours (FR-THM-005, ADR-0055)', () => {
  it('FR-THM-005: every text/background pair from 1-3 seeds is at least 4.5:1', () => {
    fc.assert(
      fc.property(seeds, shuffle, (given, n) => {
        const out = palette(generatePalette({ seeds: given, shuffle: n }));
        expect(Object.keys(out.colors).sort()).toEqual([...PALETTE_ROLES].sort());
        for (const r of PALETTE_ROLES) expect(out.colors[r]).toMatch(HEX);
        for (const { role: r, against, target } of PALETTE_CONTRAST_PAIRS) {
          expect([CONTRAST_TEXT, CONTRAST_GRAPHIC]).toContain(target);
          const ratio = contrastRatio(out.colors[r], out.colors[against]) as number;
          expect(ratio, `${r} ${out.colors[r]} against ${against} ${out.colors[against]}`).toBeGreaterThanOrEqual(target);
        }
        expect(out.unmet).toEqual([]);
        expect(generatePalette({ seeds: given, shuffle: n })).toEqual({ ok: true, value: out });
      }),
    );
  });

  it('FR-THM-005: a locked role keeps its colour through shuffle', () => {
    fc.assert(
      fc.property(
        seeds,
        fc.uniqueArray(fc.tuple(role, hexColor), { minLength: 1, maxLength: 4, selector: ([r]) => r }),
        fc.tuple(shuffle, shuffle),
        (given, locked, [a, b]) => {
          const roles = locked.map(([r]) => r);
          const locks: Partial<Record<PaletteRole, string>> = Object.fromEntries(locked);
          for (const n of [0, a, b]) {
            const out = palette(generatePalette({ seeds: given, locks, shuffle: n }));
            for (const r of roles) expect(out.colors[r]).toBe(locks[r]);
            for (const r of PALETTE_ROLES) expect(out.colors[r]).toMatch(HEX);
            expect(out.adjusted.filter((r) => roles.includes(r))).toEqual([]);
          }
        },
      ),
    );
  });

  it('FR-THM-005: a locked hue slot is never shuffled into another slot', () => {
    fc.assert(fc.property(seedColor, fc.integer({ min: 0, max: HUE_SLOTS.length - 1 }), shuffle, (seed, k, n) => lockedSlotStays(seed, k, n)));
  });

  it('FR-THM-005: a locked hue slot stays put for a grey oklch() seed whose written hue is not its emitted one (counterexample)', () => {
    lockedSlotStays('oklch(0.0000 0.0000 127.06)', 5, 0);
  });

  it('FR-THM-005: with one locked role, every pair with an unlocked side is met unless no lightness of that side can meet it', () => {
    fc.assert(
      fc.property(seeds, role, hexColor, shuffle, (given, locked, colour, n) => {
        const out = palette(generatePalette({ seeds: given, locks: { [locked]: colour }, shuffle: n }));
        for (const miss of out.unmet) {
          const sides = [miss.role, miss.against].filter((r) => r !== locked);
          expect(sides.length, `${miss.role}/${miss.against}`).toBeGreaterThan(0);
          expect(
            sides.some((side) => !fixable(out.colors, side)),
            `${miss.role}/${miss.against} ${miss.ratio} with ${locked}=${colour}`,
          ).toBe(true);
        }
      }),
    );
  });

  it('FR-THM-005: one role locked to black or white leaves no pair unmet', () => {
    fc.assert(
      fc.property(seeds, role, fc.constantFrom('#000000', '#ffffff'), shuffle, (given, locked, colour, n) => {
        const out = palette(generatePalette({ seeds: given, locks: { [locked]: colour }, shuffle: n }));
        expect(out.unmet, `${locked}=${colour}`).toEqual([]);
        expect(out.colors[locked]).toBe(colour);
      }),
    );
  });

  it('FR-THM-005: under one lock, no two fills are the same hex wherever their contrast band leaves room', () => {
    fc.assert(
      fc.property(oneLock, (args) => {
        const out = lockedPalette(args);
        fc.pre(out.unmet.length === 0 && midBand(out.colors) >= ROOMY);
        expect(new Set(FILLS.map((f) => out.colors[f])).size, FILLS.map((f) => out.colors[f]).join(' ')).toBe(FILLS.length);
      }),
    );
  });

  it('FR-THM-005: under one lock, every two fills are at least 0.02 apart in OKLab wherever their contrast band leaves room', () => {
    fc.assert(
      fc.property(oneLock, (args) => {
        const out = lockedPalette(args);
        fc.pre(out.unmet.length === 0 && midBand(out.colors) >= ROOMY);
        for (const [i, f] of FILLS.entries())
          for (const g of FILLS.slice(i + 1))
            expect(oklabDistance(lch(out.colors[f]), lch(out.colors[g])), `${f} ${out.colors[f]} / ${g} ${out.colors[g]}`).toBeGreaterThanOrEqual(
              MIN_FILL_DISTANCE,
            );
      }),
    );
  });

  it('FR-THM-005: two equal grey seeds in a 0.02-wide band fall outside the distinct-fills condition (counterexample)', () => {
    const grey = 'oklch(0.0000 0.0000 0.00)';
    const out = palette(generatePalette({ seeds: [grey, grey, grey], locks: { text: '#7cfc58' }, shuffle: 1221216175 }));
    expect(out.unmet).toEqual([]);
    expect(midBand(out.colors)).toBeGreaterThanOrEqual(0.02);
    expect(midBand(out.colors)).toBeLessThan(ROOMY);
  });
});
