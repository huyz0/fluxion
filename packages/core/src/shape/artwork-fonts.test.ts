import type { SvgArtworkNode } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { normalizeSvgArtworkFonts } from '../index.js';

const face = { family: 'Source Alias', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
const root = (): SvgArtworkNode => ({
  name: 'svg',
  attributes: {},
  children: [{ name: 'text', attributes: { 'font-family': face.family }, children: ['API'] }],
});

describe('FR-LIB-004: shared checked-artwork font normalization', () => {
  it('normalizes inherited descriptors and returns only used exact faces', () => {
    const original = root();
    const result = normalizeSvgArtworkFonts(original, { fonts: [face] });
    expect(result.error).toBeUndefined();
    expect(result.fonts).toEqual([face]);
    expect(result.root.children[0]).toEqual({
      name: 'text',
      attributes: { 'font-family': face.family, 'font-weight': '400', 'font-style': 'normal' },
      children: ['API'],
    });
    expect(original.children[0]).toEqual({ name: 'text', attributes: { 'font-family': face.family }, children: ['API'] });
  });
  it('retains refusals for missing faces, duplicate byte identities and unsupported text', () => {
    expect(normalizeSvgArtworkFonts(root(), { fonts: [] }).error).toBe('missing-exact-font-face');
    expect(normalizeSvgArtworkFonts(root(), { fonts: [face, { ...face, family: 'Other Alias' }] }).error).toBe('invalid-font-catalog');
    const input: SvgArtworkNode = { ...root(), children: [{ name: 'text', attributes: { 'font-family': face.family }, children: ['非'] }] };
    expect(normalizeSvgArtworkFonts(input, { fonts: [face] }).error).toBe('unsupported-text-profile');
  });
  it('retains referenced-text refusal rather than guessing inherited faces', () => {
    const input: SvgArtworkNode = {
      ...root(),
      children: [
        { name: 'text', attributes: { id: 'label' }, children: ['API'] },
        { name: 'use', attributes: { href: '#label' }, children: [] },
      ],
    };
    expect(normalizeSvgArtworkFonts(input, { fonts: [face], defaultFont: face.sha256 }).error).toBe('unsupported-text-reference-inheritance');
  });
});
