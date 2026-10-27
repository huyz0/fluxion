import type { SvgArtworkNode } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { aliasSvgArtworkFonts, artworkFontAlias, isArtworkFontAlias, normalizeSvgArtworkFonts } from '../index.js';

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

describe('FR-LIB-004 FR-AST-003: renderer-facing private aliases (M18.97)', () => {
  const binding = { ...face, alias: artworkFontAlias(face.sha256) };
  it('derives the alias from the byte identity alone', () => {
    expect(artworkFontAlias(face.sha256)).toBe(`fx-artwork-${face.sha256}`);
    expect(artworkFontAlias('b'.repeat(64))).not.toBe(artworkFontAlias(face.sha256));
  });
  it('reserves the alias namespace in any case or quoting', () => {
    for (const family of [artworkFontAlias(face.sha256), ' FX-Artwork-x', '"fx-artwork-x"', "'fx-artwork-'"])
      expect(isArtworkFontAlias(family), family).toBe(true);
    for (const family of ['Inter', 'fx-artworks', 'my fx-artwork-x']) expect(isArtworkFontAlias(family), family).toBe(false);
  });
  it('names the alias on each bound text, drops its inline font declarations and leaves the canonical artwork alone', () => {
    const original: SvgArtworkNode = {
      name: 'svg',
      attributes: { 'font-family': face.family },
      children: [{ name: 'text', attributes: { style: 'fill:red;font-family:Other;font-weight:700' }, children: ['API'] }],
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    // the inline declarations are dropped, so the inherited family (bound) applies at weight 400
    const result = aliasSvgArtworkFonts({ ...original, children: [{ name: 'text', attributes: { style: 'fill:red' }, children: ['API'] }] }, [binding]);
    expect(result).toEqual({
      ok: true,
      root: {
        ...original,
        children: [
          { name: 'text', attributes: { style: 'fill:red', 'font-family': binding.alias, 'font-weight': '400', 'font-style': 'normal' }, children: ['API'] },
        ],
      },
    });
    expect(original).toEqual(snapshot);
    const overridden = aliasSvgArtworkFonts(original, [binding]);
    expect(overridden).toEqual({ ok: false, error: 'missing-exact-font-face' }); // its own style names Other 700, which has no binding
  });
  it('drops bound inline font declarations, so imported style cannot override the alias', () => {
    const styled: SvgArtworkNode = {
      name: 'svg',
      attributes: {},
      children: [{ name: 'text', attributes: { style: `fill:red;font-family:'${face.family}';font-weight:400;font-style:normal` }, children: ['API'] }],
    };
    const result = aliasSvgArtworkFonts(styled, [binding]);
    expect(result.ok && result.root.children).toEqual([
      { name: 'text', attributes: { style: 'fill:red', 'font-family': binding.alias, 'font-weight': '400', 'font-style': 'normal' }, children: ['API'] },
    ]);
  });
  it('refuses unbound faces, unsupported text and text references instead of falling back', () => {
    expect(aliasSvgArtworkFonts(root(), [])).toEqual({ ok: false, error: 'missing-exact-font-face' });
    expect(aliasSvgArtworkFonts(root(), [{ ...binding, family: 'Other' }])).toEqual({ ok: false, error: 'missing-exact-font-face' });
    const wide: SvgArtworkNode = { ...root(), children: [{ name: 'text', attributes: { 'font-family': face.family }, children: ['非'] }] };
    expect(aliasSvgArtworkFonts(wide, [binding])).toEqual({ ok: false, error: 'unsupported-text-profile' });
    const used: SvgArtworkNode = {
      name: 'svg',
      attributes: {},
      children: [
        { name: 'g', attributes: { id: 't' }, children: [{ name: 'text', attributes: {}, children: ['A'] }] },
        { name: 'use', attributes: { href: '#t' }, children: [] },
      ],
    };
    expect(aliasSvgArtworkFonts(used, [binding])).toEqual({ ok: false, error: 'unsupported-text-reference-inheritance' });
  });
  it('matches families case-insensitively and leaves empty text untouched', () => {
    const upper: SvgArtworkNode = {
      name: 'svg',
      attributes: {},
      children: [
        { name: 'text', attributes: { 'font-family': 'SOURCE ALIAS' }, children: ['A'] },
        { name: 'text', attributes: {}, children: [' '] },
      ],
    };
    const result = aliasSvgArtworkFonts(upper, [binding]);
    expect(result.ok && result.root.children).toEqual([
      { name: 'text', attributes: { 'font-family': binding.alias, 'font-weight': '400', 'font-style': 'normal' }, children: ['A'] },
      { name: 'text', attributes: {}, children: [' '] },
    ]);
  });
});
