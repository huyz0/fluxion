import { describe, expect, it } from 'vitest';
import { checkContrast, contrastTarget, textContrastKind } from './contrast-lint.js';
import { contrastRatio, parseColor } from './oklch.js';

/** The hue (degrees) of a colour, for checking the fix keeps it. */
const hue = (css: string): number => parseColor(css)?.h ?? Number.NaN;

describe('the contrast check (NFR-A11Y-005)', () => {
  it('NFR-A11Y-005: text below 4.5:1 is flagged', () => {
    // #767676 on white is 4.54:1 (passes); #777777 is 4.48:1 (fails)
    expect(checkContrast({ kind: 'text', color: '#767676', against: '#ffffff' })).toBeUndefined();
    const issue = checkContrast({ kind: 'text', color: '#777777', against: '#ffffff' });
    expect(issue).toMatchObject({ kind: 'text', target: 4.5 });
    expect(issue?.ratio).toBeCloseTo(4.48, 2);
    // the fix passes, and is the nearest: just darker than the colour, not black
    expect(contrastRatio(issue?.fix as string, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(issue?.fix).not.toBe('#000000');
    expect(contrastRatio(issue?.fix as string, '#ffffff')).toBeLessThan(4.8);
  });

  it('NFR-A11Y-005: large text below 3:1 is flagged', () => {
    // 3.5:1 fails body text but passes large text; 2.5:1 fails both
    expect(checkContrast({ kind: 'large-text', color: '#8a8a8a', against: '#ffffff' })).toBeUndefined();
    expect(checkContrast({ kind: 'text', color: '#8a8a8a', against: '#ffffff' })).toBeDefined();
    const issue = checkContrast({ kind: 'large-text', color: '#a6a6a6', against: '#ffffff' });
    expect(issue).toMatchObject({ kind: 'large-text', target: 3 });
    expect(contrastRatio(issue?.fix as string, '#ffffff')).toBeGreaterThanOrEqual(3);
    // large: 24 px, or bold from 18.66 px
    expect(textContrastKind(24, 400)).toBe('large-text');
    expect(textContrastKind(23.9, 400)).toBe('text');
    expect(textContrastKind(18.66, 700)).toBe('large-text');
    expect(textContrastKind(18.66, 600)).toBe('text');
    expect(textContrastKind(18.6, 700)).toBe('text');
  });

  it('NFR-A11Y-005: a stroke below 3:1 is flagged', () => {
    const issue = checkContrast({ kind: 'stroke', color: '#93c5fd', against: '#ffffff' });
    expect(issue).toMatchObject({ kind: 'stroke', target: 3, color: '#93c5fd', against: '#ffffff' });
    // the fix keeps the hue: a deeper blue, not a grey
    expect(contrastRatio(issue?.fix as string, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(Math.abs(hue(issue?.fix as string) - hue('#93c5fd'))).toBeLessThan(3);
    // on a dark background the fix is lighter
    const dark = checkContrast({ kind: 'stroke', color: '#1e3a8a', against: '#0b1020' });
    expect(parseColor(dark?.fix as string)?.l).toBeGreaterThan(parseColor('#1e3a8a')?.l as number);
    expect(contrastRatio(dark?.fix as string, '#0b1020')).toBeGreaterThanOrEqual(3);
  });

  it('NFR-A11Y-005: a combination at AA is not flagged', () => {
    expect(checkContrast({ kind: 'text', color: '#0f172a', against: '#ffffff' })).toBeUndefined();
    expect(checkContrast({ kind: 'stroke', color: '#949494', against: '#ffffff' })).toBeUndefined();
    expect(checkContrast({ kind: 'large-text', color: 'rgb(148 148 148)', against: '#ffffff' })).toBeUndefined();
    // a colour that cannot be read is not judged
    expect(checkContrast({ kind: 'text', color: 'var(--x)', against: '#ffffff' })).toBeUndefined();
    expect(contrastTarget('text')).toBe(4.5);
    expect(contrastTarget('stroke')).toBe(3);
  });
});
